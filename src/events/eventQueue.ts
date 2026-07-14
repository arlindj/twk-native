import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256Hex } from '../utils/crypto';
import { sendEventBatch } from '../api/client';
import { SessionEvent, SessionEventType } from '../types';

/**
 * Event Queue — protects evidence from network failures.
 * Events are persisted locally first, then flushed in batches with an
 * idempotency key so retries never duplicate rows on the backend.
 *
 * Storage is namespaced per session so starting a new session can never
 * destroy another session's un-flushed events. An index of stored
 * queues is kept so stale ones (whose session token is long gone) get
 * pruned instead of accumulating forever.
 */

const STORAGE_PREFIX = 'twk_event_queue_v1';
const INDEX_KEY = 'twk_event_queue_sessions_v1';
const LEGACY_KEY = 'twk_event_queue_v1';
const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 4000;
const QUEUE_TTL_MS = 7 * 24 * 3600 * 1000;

interface QueueState {
  sessionId: string;
  events: SessionEvent[];
  /** Next event sequence number — NOT events.length: flushed events leave the array. */
  seq?: number;
}

let state: QueueState | null = null;
let seq = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let sessionStartMonotonic = 0;
let recordingStartMonotonic = -1;
let recordingSegment = -1;
let appVersion = '1.0.0';

function storageKey(sessionId: string) {
  return `${STORAGE_PREFIX}:${sessionId}`;
}

/** Monotonic-ish clock: performance.now is monotonic in Hermes. */
function nowMonotonic(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return perf?.now?.() ?? Date.now();
}

export function sessionElapsedMs(): number {
  return Math.round(nowMonotonic() - sessionStartMonotonic);
}

export function recordingElapsedMs(): number {
  if (recordingStartMonotonic < 0) return -1;
  return Math.round(nowMonotonic() - recordingStartMonotonic);
}

/** Anchors the recording clock for a new segment (0-based index). */
export function markRecordingStarted(segment: number) {
  recordingStartMonotonic = nowMonotonic();
  recordingSegment = segment;
}

export function markRecordingStopped() {
  recordingStartMonotonic = -1;
  recordingSegment = -1;
}

/** Registers this session in the queue index and prunes expired queues. */
async function updateIndex(sessionId: string) {
  let index: Record<string, number> = {};
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (raw) index = JSON.parse(raw) as Record<string, number>;
  } catch {
    /* corrupted index — rebuild */
  }
  const now = Date.now();
  for (const [id, savedAt] of Object.entries(index)) {
    if (id !== sessionId && now - savedAt > QUEUE_TTL_MS) {
      delete index[id];
      await AsyncStorage.removeItem(storageKey(id)).catch(() => undefined);
    }
  }
  index[sessionId] = now;
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export async function initQueue(sessionId: string, version: string) {
  appVersion = version;
  sessionStartMonotonic = nowMonotonic();
  recordingStartMonotonic = -1;
  recordingSegment = -1;
  seq = 0;
  state = null;

  // One-time migration off the old un-namespaced key.
  await AsyncStorage.removeItem(LEGACY_KEY).catch(() => undefined);

  // Recover events from a previous crash of the same session.
  const raw = await AsyncStorage.getItem(storageKey(sessionId));
  if (raw) {
    try {
      const prev = JSON.parse(raw) as QueueState;
      if (prev.sessionId === sessionId) {
        state = prev;
        // Flushed events leave the array, so events.length undercounts and
        // would mint duplicate eventIds (which the idempotency layer then
        // silently drops). Prefer the persisted counter; fall back to the
        // last event's id suffix.
        const last = prev.events[prev.events.length - 1];
        const lastSeq = last ? Number(last.eventId.split('_').pop()) : NaN;
        seq = prev.seq ?? (Number.isFinite(lastSeq) ? lastSeq + 1 : prev.events.length);
      }
    } catch {
      /* corrupted queue — start fresh */
    }
  }
  if (!state) {
    state = { sessionId, events: [], seq: 0 };
    await persist();
  }
  await updateIndex(sessionId);

  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
}

async function persist() {
  if (!state) return;
  state.seq = seq;
  await AsyncStorage.setItem(storageKey(state.sessionId), JSON.stringify(state));
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
    ...(recordingSegment >= 0 ? { recordingSegment } : {}),
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
      const idempotencyKey = sha256Hex(
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
  const sessionId = state?.sessionId;
  state = null;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (sessionId) {
    await AsyncStorage.removeItem(storageKey(sessionId));
    try {
      const raw = await AsyncStorage.getItem(INDEX_KEY);
      if (raw) {
        const index = JSON.parse(raw) as Record<string, number>;
        delete index[sessionId];
        await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
      }
    } catch {
      /* index cleanup is best-effort */
    }
  }
}
