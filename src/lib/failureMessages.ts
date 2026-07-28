/**
 * Participant-facing failure messages.
 *
 * Raw transport detail ("Storage upload failed with status 400") tells a tester
 * nothing they can act on, and tells whoever they report it to almost nothing
 * either. Every failure the participant can actually see is mapped here to:
 *
 *  - `title`  — what went wrong, in their words;
 *  - `detail` — why, and what happens to their data;
 *  - `retryable` — whether the "Try again" button can plausibly help. A button
 *    that can never succeed (an oversize file) is worse than no button.
 *  - `technical` — the original message, shown small. Testers screenshot this
 *    screen and send it to us; without it we are debugging from prose.
 *
 * Keep this the ONLY place that turns an error into participant-facing copy.
 */
import { RecordingFileMissingError, RecordingTooLargeError } from '../upload/uploader';
import { SynthApiError } from './synthClient';
import { ApiError } from '../api/client';

export interface FailureMessage {
  title: string;
  detail: string;
  retryable: boolean;
  technical?: string;
}

/** "58.2 MB" — participants think in MB, not bytes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * True for the transport-level failures that a later attempt can genuinely
 * fix — offline, flaky signal, a request that timed out, a 5xx. Deliberately
 * NOT a catch-all: a 4xx other than 408/429 means the request itself was
 * rejected, and repeating it verbatim will be rejected identically.
 */
function isTransient(err: unknown): boolean {
  if (err instanceof SynthApiError || err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /network|timed? ?out|timeout|connection|offline|unreachable|socket|ECONN|ENOTFOUND|-100\d/i.test(
    msg,
  );
}

/**
 * Map any thrown value to copy the participant can read. `context` shifts the
 * wording between the two screens that show failures — the upload screen talks
 * about the recording, everything earlier talks about the test itself.
 */
export function describeFailure(
  err: unknown,
  context: 'upload' | 'session' = 'upload',
): FailureMessage {
  const technical = err instanceof Error ? err.message : err ? String(err) : undefined;

  // ---- Recording-specific, terminal --------------------------------------
  if (err instanceof RecordingTooLargeError) {
    return {
      title: 'The screen recording is too large to upload',
      detail:
        `This recording is ${formatBytes(err.fileSizeBytes)}, which is over the size limit ` +
        `our server accepts for a single video. That usually means the test ran for a long ` +
        `time. Your taps, answers and results were all saved — only the video is affected.`,
      retryable: false,
      technical,
    };
  }

  if (err instanceof RecordingFileMissingError) {
    return {
      title: 'The recording file is no longer on this device',
      detail:
        'The video was removed before it could finish uploading — usually because the ' +
        'phone needed to free up storage. Your taps, answers and results were all saved; ' +
        'only the video is affected.',
      retryable: false,
      technical,
    };
  }

  // ---- Auth --------------------------------------------------------------
  if (
    (err instanceof SynthApiError || err instanceof ApiError) &&
    (err.status === 401 || err.status === 403)
  ) {
    return {
      title: 'Your test session expired',
      detail:
        'This device is no longer signed in to the study, so we could not confirm the ' +
        'upload. Reopening your invite link starts a fresh session.',
      retryable: true,
      technical,
    };
  }

  if (err instanceof ApiError && err.code === 'expired') {
    return {
      title: 'This invite link is no longer active',
      detail: 'The study may have closed, or the link has expired. Ask the research team for a new one.',
      retryable: false,
      technical,
    };
  }

  // ---- Connectivity ------------------------------------------------------
  if (isTransient(err)) {
    const status =
      err instanceof SynthApiError || err instanceof ApiError ? err.status : undefined;
    if (status && status >= 500) {
      return {
        title: 'The server had a problem',
        detail:
          `The study server responded with an error (${status}). Nothing on your side is ` +
          `wrong — waiting a moment and trying again usually works.`,
        retryable: true,
        technical,
      };
    }
    return {
      title: 'No usable connection',
      detail:
        context === 'upload'
          ? 'The upload could not reach the server. Your recording is safe on this device — ' +
            'move somewhere with a better signal or join Wi-Fi, then try again.'
          : 'We could not reach the study server. Check your connection and try again.',
      retryable: true,
      technical,
    };
  }

  // ---- Storage rejected the object for some other reason ------------------
  if (technical && /storage upload failed with status (\d+)/i.test(technical)) {
    const status = technical.match(/status (\d+)/)?.[1];
    return {
      title: 'The server refused the recording',
      detail:
        `Uploading the video failed with an unexpected response (${status}). Your taps and ` +
        `answers were saved. If retrying does not help, send this screen to the research team.`,
      retryable: true,
      technical,
    };
  }

  // ---- Fallback: honest, and still carries the raw detail ------------------
  return {
    title: context === 'upload' ? 'The upload did not finish' : 'Something went wrong',
    detail:
      context === 'upload'
        ? 'Your recording is saved on this device, so nothing is lost yet. Try again — if it ' +
          'keeps failing, send this screen to the research team.'
        : 'Please try again. If it keeps happening, send this screen to the research team.',
    retryable: true,
    technical,
  };
}

/**
 * Why a screen-recording segment was dropped, for the done screen. The count
 * alone ("1 part could not be saved") leaves the tester guessing whether they
 * did something wrong.
 */
export type LostSegmentReason = 'too_large' | 'file_missing' | 'stop_failed';

const LOST_SEGMENT_CAUSE: Record<LostSegmentReason, string> = {
  too_large: ' because the video was larger than the server accepts (the test ran a long time)',
  file_missing: ' because the file was removed from this device before it could upload',
  stop_failed: ' because the phone could not finish writing the video file',
};

export function describeLostSegments(
  count: number,
  reasons: readonly LostSegmentReason[],
): string {
  const parts =
    count === 1 ? 'One part of the screen recording' : `${count} parts of the screen recording`;
  const unique = [...new Set(reasons)];
  // Only name a cause when every drop shares it — stitching two different
  // explanations into one sentence reads worse than the plain count.
  const why = unique.length === 1 ? LOST_SEGMENT_CAUSE[unique[0]!] : '';
  return `${parts} could not be saved${why}. Your taps and answers were submitted in full.`;
}
