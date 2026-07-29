import ReactNativeBlobUtil from 'react-native-blob-util';
import { completeRecording, getUploadUrl } from '../api/client';
import { ensureFreshAuth } from '../lib/synthClient';
import { retry, TimeoutError } from '../lib/retry';
import { RecordingCompletePayload } from '../types';

/**
 * Uploader — moves the recorded video to object storage through a
 * signed URL, then finalizes metadata on the API. The local file is
 * kept until the backend confirms the upload (crash-safe).
 */

export interface UploadProgress {
  state: 'requesting_url' | 'uploading' | 'finalizing' | 'done' | 'failed_retryable';
  attempt: number;
  /**
   * 0..1 for the byte transfer itself, when the platform reports it.
   *
   * A coarse state alone left the participant watching a spinner that never
   * moved: 5% and 95% looked identical, so the rational move was to give up on
   * a transfer that was nearly finished. Undefined while requesting the URL or
   * finalizing, where there is nothing meaningful to measure.
   */
  fraction?: number;
  /** Size of the segment being sent, so the UI can name the cost in MB. */
  totalBytes?: number;
}

/**
 * The local segment file no longer exists (OS evicted the cache, or a
 * crash orphaned it). Retrying can never succeed — callers must drop
 * the segment and move on instead of looping forever.
 */
export class RecordingFileMissingError extends Error {
  constructor(fileUri: string) {
    super(`Recording file missing: ${fileUri}`);
  }
}

/**
 * Object storage refused the file for exceeding its maximum object size.
 * Retrying is pointless — the file will be exactly as big next time — so this
 * is terminal like RecordingFileMissingError: the caller drops the segment and
 * still finalizes the session (taps, answers and outcomes are unaffected).
 *
 * Supabase Storage reports this as HTTP **400** with a body of
 * `{"statusCode":"413","error":"Payload too large","message":"The object
 * exceeded the maximum allowed size"}` — the 413 lives in the body, not the
 * status line, which is why a plain status check reads it as a generic 400.
 * The ceiling that bites is the *project-wide* upload limit, which is lower
 * than the bucket's own file_size_limit; it is deliberately NOT duplicated
 * here as a constant, because raising it server-side must not require an app
 * release to take effect.
 */
export class RecordingTooLargeError extends Error {
  constructor(readonly fileSizeBytes: number) {
    super(`Recording too large for storage: ${fileSizeBytes} bytes`);
  }
}

/** True when a storage response is a size rejection rather than a transient fault. */
function isTooLargeResponse(status: number, body: string): boolean {
  if (status === 413) return true;
  if (status !== 400) return false;
  return /"statusCode"\s*:\s*"?413"?|payload too large|exceeded the maximum/i.test(body);
}

/** blob-util fs APIs take plain paths, not file:// URIs. */
function toPath(fileUri: string): string {
  return fileUri.startsWith('file://') ? decodeURI(fileUri.slice('file://'.length)) : fileUri;
}

/**
 * Stall detector for the PUT — an *idle* bound, not a total one.
 *
 * blob-util maps this to `timeoutIntervalForRequest` on iOS and to OkHttp's
 * connect/read timeouts on Android, all of which measure time with no traffic
 * rather than time overall. So a slow-but-alive link can take as long as it
 * needs to move tens of megabytes, while a socket that stops moving entirely —
 * the 5G↔Wi-Fi handoff casualty that used to hang the upload screen forever
 * with no rejection to retry on — fails within two minutes.
 */
const PUT_TIMEOUT_MS = 120 * 1000;
/** The metadata POST carries a few hundred bytes; it has no excuse to be slow. */
const FINALIZE_TIMEOUT_MS = 30 * 1000;

/**
 * A PUT that neither completed nor failed. Distinct from the size/missing
 * errors because it is exactly the case worth retrying.
 */
function isRetryableUploadError(err: unknown): boolean {
  if (err instanceof RecordingTooLargeError) return false;
  if (err instanceof RecordingFileMissingError) return false;
  return true;
}

export async function uploadRecording(opts: {
  sessionId: string;
  recordingId: string;
  fileUri: string;
  durationMs: number;
  /** 0-based recording segment index within the session. */
  segment: number;
  width: number;
  height: number;
  onProgress?: (p: UploadProgress) => void;
  maxAttempts?: number;
}): Promise<RecordingCompletePayload> {
  const { sessionId, recordingId, fileUri, durationMs, segment, width, height, onProgress } = opts;
  const path = toPath(fileUri);

  if (!(await ReactNativeBlobUtil.fs.exists(path))) {
    throw new RecordingFileMissingError(fileUri);
  }
  const stat = await ReactNativeBlobUtil.fs.stat(path);
  const fileSizeBytes = Number(stat.size) || 0;
  let md5 = 'unknown';
  try {
    md5 = await ReactNativeBlobUtil.fs.hash(path, 'md5');
  } catch {
    /* hash unsupported — checksum stays "unknown" */
  }
  const checksum = `md5:${md5}`;

  // A multi-minute transfer must not start on a token that expires halfway
  // through: the bytes would land and `recordings/complete` would 401, telling
  // the participant their session expired after the work was already done.
  await ensureFreshAuth();

  // ---- Phase 1: the bytes ------------------------------------------------
  // Retried on its own. The old loop wrapped the PUT and the metadata POST in
  // one try, so a failure on the (tiny) POST re-ran the whole multi-tens-of-MB
  // transfer — and, because `recordings/start` deletes the object before
  // re-signing, it genuinely re-uploaded every byte on the participant's data.
  const storageKey = await retry(
    async (attempt) => {
      onProgress?.({ state: 'requesting_url', attempt, totalBytes: fileSizeBytes });
      const { uploadUrl, storageKey: key } = await getUploadUrl(sessionId, recordingId, fileSizeBytes);

      onProgress?.({ state: 'uploading', attempt, fraction: 0, totalBytes: fileSizeBytes });
      // NOTE: blob-util's `IOSBackgroundTask` is deliberately NOT set here.
      // It looks like the fix for "the upload dies when the app is
      // backgrounded", but it switches the request onto
      // `backgroundSessionConfigurationWithIdentifier` *and* onto a
      // `NSURLSessionDownloadTask`, while `wrap()` attaches the file with
      // `setHTTPBodyStream:` (ReactNativeBlobUtilReqBuilder.mm:140). Background
      // NSURLSessions reject stream bodies outright — they require
      // `uploadTask(with:fromFile:)` — so enabling it would trade an
      // interrupted upload for one that never works on iOS at all. Continuation
      // is handled instead by the foreground nudge in UploadScreen, and a
      // proper background upload needs native work (see the deferred item in
      // the change notes).
      const task = ReactNativeBlobUtil.config({
        timeout: PUT_TIMEOUT_MS,
      }).fetch('PUT', uploadUrl, { 'Content-Type': 'video/mp4' }, ReactNativeBlobUtil.wrap(path));

      task.uploadProgress({ interval: 250 }, (written, total) => {
        const denominator = Number(total) > 0 ? Number(total) : fileSizeBytes;
        if (denominator <= 0) return;
        onProgress?.({
          state: 'uploading',
          attempt,
          fraction: Math.min(1, Number(written) / denominator),
          totalBytes: fileSizeBytes,
        });
      });

      const res = await task;
      const status = res.info().status;
      if (status < 200 || status >= 300) {
        let body = '';
        try {
          // blob-util types this as string | Promise<any> depending on how the
          // response was buffered; awaiting covers both.
          body = String((await res.text()) ?? '');
        } catch {
          /* body unavailable — fall through to the generic message */
        }
        if (isTooLargeResponse(status, body)) {
          // Terminal — isRetryableUploadError stops the loop rather than
          // burning more full-file uploads on a deterministic rejection.
          throw new RecordingTooLargeError(fileSizeBytes);
        }
        throw new Error(`Storage upload failed with status ${status}`);
      }
      return key;
    },
    {
      attempts: opts.maxAttempts ?? 6,
      isRetryable: isRetryableUploadError,
      onRetry: (attempt) => onProgress?.({ state: 'failed_retryable', attempt }),
    },
  );

  // ---- Phase 2: the metadata row ----------------------------------------
  // Small, idempotent (upsert by recording id server-side), and retried
  // independently so it can never cost a second byte of the participant's data.
  const payload: RecordingCompletePayload = {
    recordingId,
    storageKey,
    durationMs,
    segment,
    checksum,
    fileSizeBytes,
    width,
    height,
  };
  await retry(
    async (attempt) => {
      onProgress?.({ state: 'finalizing', attempt });
      await completeRecording(sessionId, payload, FINALIZE_TIMEOUT_MS);
    },
    { attempts: 4, baseDelayMs: 1000 },
  );

  onProgress?.({ state: 'done', attempt: 1 });
  // Only now is the local copy safe to delete.
  await ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
  return payload;
}

/** Byte size of a finished segment, or 0 when the file is gone. */
export async function segmentSizeBytes(fileUri: string): Promise<number> {
  try {
    const path = toPath(fileUri);
    if (!(await ReactNativeBlobUtil.fs.exists(path))) return 0;
    const stat = await ReactNativeBlobUtil.fs.stat(path);
    return Number(stat.size) || 0;
  } catch {
    return 0;
  }
}

export { TimeoutError };
