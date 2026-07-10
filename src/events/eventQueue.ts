import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { sendEventBatch } from '../api/client';
import { SessionEvent, SessionEventType } from '../types';

/**
 * Event Queue — protects evidence from network failures.
 * Events are persisted locally first, then flushed in batches with an
 * idempotency key so retries never duplicate rows on the backend.
 */

const STORAGE_KEY = 'twk_event_queue_v1';
const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 4000;

interface QueueState {
  sessionId: string;
  events: SessionEvent[];
}

let state: QueueState | null = null;
let seq = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let sessionStartMonotonic = 0;
let recordingStartMonotonic = -1;
let appVersion = '1.0.0';

/** Monotonic-ish clock: performance.now is monotonic in Hermes. */
function nowMonotonic(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function sessionElapsedMs(): number {
  return Math.round(nowMonotonic() - sessionStartMonotonic);
}

export function recordingElapsedMs(): number {
  if (recordingStartMonotonic < 0) return -1;
  return Math.round(nowMonotonic() - recordingStartMonotonic);
}

export function markRecordingStarted() {
  recordingStartMonotonic = nowMonotonic();
}

export function markRecordingStopped() {
  recordingStartMonotonic = -1;
}

export async function initQueue(sessionId: string, version: string) {
  appVersion = version;
  sessionStartMonotonic = nowMonotonic();
  recordingStartMonotonic = -1;
  seq = 0;

  // Recover events from a previous crash of the same session.
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const prev = JSON.parse(raw) as QueueState;
      if (prev.sessionId === sessionId) {
        state = prev;
        seq = prev.events.length;
      }
    } catch {
      /* corrupted queue — start fresh */
    }
  }
  if (!state || state.sessionId !== sessionId) {
    state = { sessionId, events: [] };
    await persist();
  }

  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
}

async function persist() {
  if (!state) return;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function track(
  type: SessionEventType,
  fields: Partial<Omit<SessionEvent, 'eventId' | 'sessionId' | 'type' | 'appVersion'>> = {},
) {
  if (!state) return;
  const event: SessionEvent = {
    eventId: `evt_${state.sessionId}_${seq++}`,
    sessionId: state.sessionId,
    type,
    timestampMs: sessionElapsedMs(),
    recordingTimeMs: recordingElapsedMs(),
    appVersion,
    ...fields,
  };
  state.events.push(event);
  void persist();
}

/** Flush pending events; safe to call concurrently. */
export async function flush(): Promise<boolean> {
  if (!state || flushing || state.events.length === 0) return true;
  flushing = true;
  try {
    while (state.events.length > 0) {
      const batch = state.events.slice(0, MAX_BATCH);
      const idempotencyKey = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${state.sessionId}:${batch[0].eventId}:${batch[batch.length - 1].eventId}`,
      );
      await sendEventBatch(state.sessionId, idempotencyKey, batch);
      state.events = state.events.slice(batch.length);
      await persist();
    }
    return true;
  } catch {
    // Network failed — events stay queued, timer retries.
    return false;
  } finally {
    flushing = false;
  }
}

/** Final drain at session completion. Returns true when queue is empty. */
export async function drain(): Promise<boolean> {
  const ok = await flush();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  return ok && (state?.events.length ?? 0) === 0;
}

export async function clearQueue() {
  state = null;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
}
