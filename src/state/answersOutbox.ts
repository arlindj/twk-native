import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendAnswers } from '../api/client';
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
    await persist();
    return true;
  } catch {
    return false; // stays queued, timer retries
  } finally {
    flushing = false;
  }
}

/** Final attempt at session completion. Returns true when empty. */
export async function drainAnswers(): Promise<boolean> {
  const ok = await flushAnswers();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  return ok && pending.length === 0;
}

export async function clearAnswersOutbox() {
  const id = sessionId;
  sessionId = null;
  pending = [];
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (id) await AsyncStorage.removeItem(storageKey(id)).catch(() => undefined);
}
