import * as SecureStore from '../native/secureStore';
import { randomUUID } from '../utils/crypto';
import {
  AnswerPayload,
  BootstrapPayload,
  DeviceContext,
  ParticipantProfile,
  RecordingCompletePayload,
  SessionEvent,
  StartSessionResponse,
} from '../types';

/**
 * Session Client — the only door to the backend. The mobile app never
 * talks to the database; every payload is scoped by the participant
 * session token returned from /mobile/sessions/start.
 */

const DEFAULT_API_BASE = 'https://test.tawakkalnaos.app/api';

let apiBase = DEFAULT_API_BASE;
let sessionToken: string | null = null;

export function setApiBase(url: string) {
  apiBase = url.replace(/\/$/, '');
}

export function getApiBase() {
  return apiBase;
}

export async function persistToken(sessionId: string, token: string) {
  sessionToken = token;
  await SecureStore.setItem('twk_session_token', JSON.stringify({ sessionId, token }));
}

export async function restoreToken(sessionId: string): Promise<boolean> {
  const raw = await SecureStore.getItem('twk_session_token');
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { sessionId: string; token: string };
    if (parsed.sessionId !== sessionId) return false;
    sessionToken = parsed.token;
    return true;
  } catch {
    return false;
  }
}

/**
 * Stable anonymous guest id for this device. No login: we mint a random
 * id once and reuse it across sessions so the dashboard can recognize a
 * returning tester without ever knowing who they are.
 */
export async function getGuestParticipantId(): Promise<string> {
  const existing = await SecureStore.getItem('twk_guest_id');
  if (existing) return existing;
  const id = `guest_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await SecureStore.setItem('twk_guest_id', id);
  return id;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  opts: { auth?: boolean; retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { auth = true, retries = 2, timeoutMs = 15000 } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Per-attempt timeout: a stalled socket must never strand the session
    // on a spinner. On timeout the request aborts and the retry loop runs.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        let code = 'unknown_error';
        let message = `Request failed with status ${res.status}`;
        try {
          const data = await res.json();
          code = data.code ?? code;
          message = data.message ?? message;
        } catch {
          /* non-JSON error body */
        }
        // 4xx errors are contract errors — retrying will not help.
        if (res.status < 500) throw new ApiError(res.status, code, message);
        lastError = new ApiError(res.status, code, message);
      } else {
        return (await res.json()) as T;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise<void>((r) => setTimeout(() => r(), 500 * 2 ** attempt));
  }
  throw lastError;
}

/* ------------------------- Endpoint map ------------------------- */

export function startSession(testToken: string, device: DeviceContext) {
  return request<StartSessionResponse>(
    'POST',
    '/mobile/sessions/start',
    { testToken, device },
    { auth: false },
  );
}

export function fetchBootstrap(sessionId: string) {
  return request<BootstrapPayload>('GET', `/mobile/sessions/${sessionId}/bootstrap`);
}

export function acceptConsent(sessionId: string, consentVersion: string, deviceId: string) {
  return request<{ ok: true }>('POST', `/mobile/sessions/${sessionId}/consent`, {
    consentVersion,
    acceptedAt: new Date().toISOString(),
    deviceId,
  });
}

/** Guest profile for personas — no auth, just self-reported fields + device guest id. */
export async function submitParticipantProfile(sessionId: string, profile: Omit<ParticipantProfile, 'participantId'>) {
  const participantId = await getGuestParticipantId();
  return request<{ ok: true; participantId: string }>(
    'POST',
    `/mobile/sessions/${sessionId}/participant`,
    { ...profile, participantId },
  );
}

export function startRecordingSlot(sessionId: string) {
  return request<{ recordingId: string }>('POST', `/mobile/sessions/${sessionId}/recording/start`, {});
}

export function sendEventBatch(sessionId: string, idempotencyKey: string, events: SessionEvent[]) {
  return request<{ accepted: number }>('POST', `/mobile/sessions/${sessionId}/events/batch`, {
    idempotencyKey,
    events,
  });
}

export function sendAnswers(sessionId: string, answers: AnswerPayload[]) {
  return request<{ ok: true }>('POST', `/mobile/sessions/${sessionId}/answers`, { answers });
}

export function getUploadUrl(sessionId: string, recordingId: string, fileSizeBytes: number) {
  return request<{ uploadUrl: string; storageKey: string }>(
    'POST',
    `/mobile/sessions/${sessionId}/recording/upload-url`,
    { recordingId, contentType: 'video/mp4', fileSizeBytes },
  );
}

export function completeRecording(sessionId: string, payload: RecordingCompletePayload) {
  return request<{ ok: true }>('POST', `/mobile/sessions/${sessionId}/recording/complete`, payload);
}

export function completeSession(sessionId: string) {
  return request<{ ok: true }>('POST', `/mobile/sessions/${sessionId}/complete`, {});
}

/**
 * Uploads a frame capture (screenshot of the prototype viewport). The
 * backend clusters visually-identical frames into stable screen keys, so
 * canvas-rendered prototypes (Figma) get per-screen analytics without any
 * cooperation from the viewer.
 */
export function uploadFrame(sessionId: string, imageBase64: string, atMs: number) {
  return request<{ screenKey: string | null; isNew: boolean; blank?: boolean }>(
    'POST',
    `/mobile/sessions/${sessionId}/frames`,
    { imageBase64, atMs },
    { retries: 1, timeoutMs: 20000 },
  );
}
