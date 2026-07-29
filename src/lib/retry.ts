import { isOnline, waitForConnection } from './connectivity';

/**
 * Retry policy — shared by every network path that must survive a phone.
 *
 * The old policy was four attempts with a plain doubling backoff (2s, 4s, 8s,
 * 16s) and it gave up after ~30 seconds. A tester in an elevator, a tunnel, an
 * underground car park or a lift lobby loses signal for longer than that
 * routinely, so the "retry" was decoration. Two changes make it real:
 *
 *  1. **Wait for the radio, don't count against it.** Between attempts we park
 *     on `waitForConnection`, which resolves the moment the OS reports a usable
 *     connection. Coming out of a tunnel resumes in the same second instead of
 *     on the next backoff tick, and a long outage no longer consumes attempts.
 *  2. **No sleep after the final attempt.** The old loop slept 16 seconds and
 *     *then* threw, so the participant sat looking at a spinner for a result
 *     that was already decided.
 *
 * Jitter is full-random rather than fixed: several sessions failing at the same
 * moment (a flaky venue Wi-Fi during a group test) would otherwise retry in
 * lockstep and hammer the same second.
 */

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** First backoff delay; doubles per attempt up to `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** How long to wait for connectivity to return before spending an attempt. */
  offlineWaitMs?: number;
  /**
   * Return false to stop immediately — used for deterministic rejections
   * (an oversize file, a missing file, a 4xx) where repeating the identical
   * request is guaranteed to fail identically.
   */
  isRetryable?: (err: unknown) => boolean;
  /** Called before each attempt, 1-based. */
  onAttempt?: (attempt: number) => void;
  /** Called after a failed attempt that will be retried. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

export const DEFAULT_ATTEMPTS = 6;

function jittered(delayMs: number): number {
  // Full jitter: uniform in [delay/2, delay).
  return Math.round(delayMs / 2 + Math.random() * (delayMs / 2));
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const maxDelayMs = opts.maxDelayMs ?? 30000;
  const offlineWaitMs = opts.offlineWaitMs ?? 60000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Spending an attempt while the radio is provably down wastes one of a
    // small budget, so wait for the network first. A timeout here still falls
    // through and tries anyway — `isInternetReachable` can be wrong, and an
    // attempt that fails is more useful than one never made.
    if (attempt > 1 && !(await isOnline())) {
      await waitForConnection(offlineWaitMs);
    }
    opts.onAttempt?.(attempt);
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (opts.isRetryable && !opts.isRetryable(err)) throw err;
      // No sleep after the last attempt — the outcome is already decided.
      if (attempt === attempts) break;
      const delayMs = jittered(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
      opts.onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Rejects if `p` does not settle within `ms`. Used to bound native calls and
 * anything else that can hang without ever refusing.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    }),
  ]);
}

/**
 * A bounded operation ran out of time. Distinct from a generic Error so
 * failure classification does not have to pattern-match on prose (see
 * failureMessages.isTransient) — a timeout is always worth retrying.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
