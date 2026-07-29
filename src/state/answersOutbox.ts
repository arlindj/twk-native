import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendAnswers } from '../api/client';
import { retry } from '../lib/retry';
import { AnswerPayload } from '../types';

/**
 * Answers Outbox — the durable half of answer delivery. Answers are
 * persisted locally before the network is attempted, retried on an
 * interval and drained at session end, so an offline stretch during
 * the questions never loses the values. (Each answer's value is also
 * mirrored into the event stream as question_answered metadata.)
 */

const STORAGE_PREFIX = 'twk_answers_outbox_v1';
const FLUSH_INTERVAL_MS = 5000;

let sessionId: string | null = null;
let pending: AnswerPayload[] = [];
let flushing = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastError: unknown = null;

/**
 * Why the last flush failed, for the caller that needs to explain it.
 *
 * `flushAnswers`/`drainAnswers` swallow the error and return a boolean, which
 * is right for the background timer — a failed flush there is normal and
 * self-healing. But at session end the caller has to tell the participant what
 * went wrong, and "false" carries no cause. Keeping the real error means
 * `describeFailure` can distinguish offline from an expired session from a 5xx
 * instead of falling back to generic copy.
 */
export function lastAnswersError(): unknown {
  return lastError;
}

/** How many answers are still undelivered. */
export function pendingAnswerCount(): number {
  return pending.length;
}

function storageKey(id: string) {
  return `${STORAGE_PREFIX}:${id}`;
}

async function persist() {
  if (!sessionId) return;
  await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(pending));
}

export async function initAnswersOutbox(id: string) {
  sessionId = id;
  pending = [];
  lastError = null;
  try {
    const raw = await AsyncStorage.getItem(storageKey(id));
    if (raw) pending = JSON.parse(raw) as AnswerPayload[];
  } catch {
    /* corrupted outbox — start fresh */
  }
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => void flushAnswers(), FLUSH_INTERVAL_MS);
}

export async function enqueueAnswers(answers: AnswerPayload[]) {
  if (!sessionId || answers.length === 0) return;
  pending.push(...answers);
  await persist();
  void flushAnswers();
}

/** Sends everything pending; safe to call concurrently. */
export async function flushAnswers(): Promise<boolean> {
  if (!sessionId || flushing || pending.length === 0) return true;
  flushing = true;
  try {
    // Backend upserts per questionId, so re-sending after a mid-batch
    // failure never duplicates answers.
    await sendAnswers(sessionId, pending);
    pending = [];
    lastError = null;
    await persist();
    return true;
  } catch (err) {
    lastError = err;
    return false; // stays queued, timer retries
  } finally {
    flushing = false;
  }
}

/**
 * Final attempt at session completion. Returns true when empty.
 *
 * Unlike the background flush this one *works* for it: the answers are the
 * whole point of the session, so a single failed request here is worth a real
 * retry with a connectivity gate rather than a shrug. The timer is stopped
 * either way, so a false return leaves the data on disk and hands the decision
 * to the caller (which must NOT clear the outbox — see sessionStore).
 */
export async function drainAnswers(): Promise<boolean> {
  // Stop the timer FIRST, then let any flush it already started finish.
  // `flushAnswers` returns true when a concurrent flush is in progress (correct
  // for the timer, which must not stack requests), so draining while one is in
  // flight would otherwise read that `true` as "delivered" and then find
  // `pending` still populated — reporting a failure for a send that was merely
  // still running.
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await waitUntilIdle();

  try {
    return await retry(
      async () => {
        const sent = await flushAnswers();
        if (!sent || pending.length > 0) {
          throw lastError ?? new Error('Answers could not be sent.');
        }
        return true;
      },
      // Bounded deliberately: the participant is watching a spinner here, so a
      // long silent wait for a radio that may not come back is worse than
      // surfacing "no usable connection" with a Try again button. The values are
      // saved on disk either way, and returning to the app retries on its own
      // (see UploadScreen's foreground nudge).
      { attempts: 5, baseDelayMs: 1200, offlineWaitMs: 25000 },
    );
  } catch {
    return false;
  }
}

/** Waits out an in-flight flush (bounded, so a wedged flush cannot hang the app). */
async function waitUntilIdle(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (flushing && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

export async function clearAnswersOutbox() {
  const id = sessionId;
  sessionId = null;
  pending = [];
  lastError = null;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (id) await AsyncStorage.removeItem(storageKey(id)).catch(() => undefined);
}
