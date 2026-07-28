import ReactNativeBlobUtil from 'react-native-blob-util';
import { completeRecording, getUploadUrl } from '../api/client';
import { RecordingCompletePayload } from '../types';

/**
 * Uploader — moves the recorded video to object storage through a
 * signed URL, then finalizes metadata on the API. The local file is
 * kept until the backend confirms the upload (crash-safe).
 */

export interface UploadProgress {
  state: 'requesting_url' | 'uploading' | 'finalizing' | 'done' | 'failed_retryable';
  attempt: number;
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
  const maxAttempts = opts.maxAttempts ?? 4;
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

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onProgress?.({ state: 'requesting_url', attempt });
      const { uploadUrl, storageKey } = await getUploadUrl(sessionId, recordingId, fileSizeBytes);

      onProgress?.({ state: 'uploading', attempt });
      const res = await ReactNativeBlobUtil.fetch(
        'PUT',
        uploadUrl,
        { 'Content-Type': 'video/mp4' },
        ReactNativeBlobUtil.wrap(path),
      );
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
          // Terminal: rethrown as-is below so the retry loop can't swallow it.
          throw new RecordingTooLargeError(fileSizeBytes);
        }
        throw new Error(`Storage upload failed with status ${status}`);
      }

      onProgress?.({ state: 'finalizing', attempt });
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
      await completeRecording(sessionId, payload);

      onProgress?.({ state: 'done', attempt });
      // Only now is the local copy safe to delete.
      await ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
      return payload;
    } catch (err) {
      // A size rejection is deterministic — burning three more attempts (and
      // three more full-file uploads on the participant's cellular data)
      // cannot change the outcome.
      if (err instanceof RecordingTooLargeError) throw err;
      lastError = err;
      onProgress?.({ state: 'failed_retryable', attempt });
      await new Promise<void>((r) => setTimeout(() => r(), 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}
