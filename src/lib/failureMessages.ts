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
import { TimeoutError } from './retry';
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
  // A bounded operation that ran out of time is always worth another attempt,
  // and it is typed, so it never has to be matched on prose.
  if (err instanceof TimeoutError) return true;
  if (err instanceof SynthApiError || err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  // The platform wording matters here and the original list only covered the
  // iOS/JS phrasings. Android's OkHttp stack says "Unable to resolve host" for
  // DNS, throws SSLHandshakeException / CertPathValidatorException when a
  // captive portal injects its own certificate, and "Software caused
  // connection abort" when the radio drops mid-request — none of which matched,
  // so every one of them fell through to the generic fallback and the
  // participant was told the wrong thing about a very ordinary network problem.
  return /network|timed? ?out|timeout|connection|offline|unreachable|socket|ECONN|ENOTFOUND|-100\d|resolve host|dns|ssl|tls|handshake|certpath|trust anchor|cert(ificate)?|abort|EAI_|stream (was )?reset|broken pipe|software caused/i.test(
    msg,
  );
}

/**
 * Which part of the submission failed. The distinction is not cosmetic — it
 * decides whether the participant's answers are already safe on the server:
 *
 *  - `results` — the answers, task outcomes and taps could not be delivered.
 *    They are still on the device and nothing has reached the study yet. This
 *    is the one that actually matters, which is why the session now submits
 *    them *before* the video (see sessionStore.finishSession).
 *  - `upload`  — the results are already in; only the screen recording is
 *    outstanding, so the copy can honestly reassure.
 *  - `session` — something earlier in the flow, before evidence collection.
 */
export type FailureContext = 'upload' | 'session' | 'results';

/**
 * Map any thrown value to copy the participant can read. `context` shifts the
 * wording between the screens that show failures — the upload screen talks
 * about the recording, the results path talks about their answers, and
 * everything earlier talks about the test itself.
 */
export function describeFailure(err: unknown, context: FailureContext = 'upload'): FailureMessage {
  const technical = err instanceof Error ? err.message : err ? String(err) : undefined;

  // ---- The answers themselves did not land -------------------------------
  // Deliberately ahead of the transport-specific branches below: what the
  // participant needs to know first is that their answers are NOT saved yet,
  // whatever the transport reason was. Always retryable — the values are on
  // disk and every one of these endpoints upserts, so trying again is safe.
  if (context === 'results') {
    // Says "your session", not "your answers": this branch covers the answers,
    // the task outcomes AND the tap/navigation stream, and any one of them can
    // be the part that failed. Naming only the answers would tell a participant
    // whose answers did land that they did not.
    const status = err instanceof SynthApiError || err instanceof ApiError ? err.status : undefined;
    if (status === 401 || status === 403) {
      return {
        title: 'We could not submit your session',
        detail:
          'This device is no longer signed in to the study, so your session is not submitted ' +
          'yet. Everything you did is saved here — try again, and if that fails, reopen your ' +
          'invite link.',
        retryable: true,
        technical,
      };
    }
    // A 5xx is not a connectivity problem, and telling the participant to "find
    // a better signal" when the study server is the thing that failed sends them
    // wandering around the building for nothing. Split the three real cases.
    const serverFault = status != null && status >= 500;
    return {
      title: 'Your session has not been submitted yet',
      detail: serverFault
        ? `The study server responded with an error (${status}). Nothing on your side is ` +
          `wrong and everything you did is saved on this device — waiting a moment and ` +
          `trying again usually works.`
        : isTransient(err)
          ? 'There is no usable connection right now. Everything you did is saved on this ' +
            'device — move somewhere with a better signal or join Wi-Fi, then try again. ' +
            'Please do not close the app before this finishes.'
          : 'Sending your session to the study failed. Everything you did is saved on this ' +
            'device, so trying again is safe. If it keeps failing, send this screen to the ' +
            'research team.',
      retryable: true,
      technical,
    };
  }

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
        'upload. Try again — if that does not help, reopening your invite link starts a ' +
        'fresh session.',
      // Retryable, but say so honestly: the button and the copy used to
      // disagree ("reopen your link" next to a "Try again" button), which left
      // the participant guessing which instruction was the real one.
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
export type LostSegmentReason =
  | 'too_large'
  | 'file_missing'
  | 'stop_failed'
  | 'upload_failed'
  | 'user_skipped';

const LOST_SEGMENT_CAUSE: Record<LostSegmentReason, string> = {
  too_large: ' because the video was larger than the server accepts (the test ran a long time)',
  file_missing: ' because the file was removed from this device before it could upload',
  stop_failed: ' because the phone could not finish writing the video file',
  upload_failed: ' because the connection did not hold long enough to send it',
  user_skipped: ' because you chose to finish without sending the video',
};

/**
 * The same causes, written for the research team rather than the participant,
 * and short enough to live in `sessions.notes`.
 *
 * Without this the reason never left the phone: `recording_discarded` is a
 * lifecycle event and `toBeat` drops lifecycle events, so a session with no
 * video was indistinguishable from one where recording was declined. Whoever
 * reviews the study needs to tell "the encoder output was too big" from "the
 * phone reclaimed the file" from "the tester was on a dead connection",
 * because only some of those are ours to fix.
 */
const LOST_SEGMENT_DIAGNOSTIC: Record<LostSegmentReason, string> = {
  too_large: 'rejected by storage as too large',
  file_missing: 'local file gone before upload (OS reclaimed storage)',
  stop_failed: 'recorder failed to finalize the file',
  upload_failed: 'upload did not complete (connection)',
  user_skipped: 'participant finished without sending the video',
};

/** One-line machine-readable summary for `sessions.notes`; '' when nothing was lost. */
export function diagnosticsNote(
  lostSegments: number,
  reasons: readonly LostSegmentReason[],
): string {
  if (lostSegments <= 0) return '';
  const counts = new Map<LostSegmentReason, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  const detail = [...counts.entries()]
    .map(([reason, n]) => `${n}× ${LOST_SEGMENT_DIAGNOSTIC[reason]}`)
    .join('; ');
  const plural = lostSegments === 1 ? 'segment' : 'segments';
  return detail
    ? `Screen recording incomplete: ${lostSegments} ${plural} missing — ${detail}.`
    : `Screen recording incomplete: ${lostSegments} ${plural} missing.`;
}

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
