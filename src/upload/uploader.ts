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
    throw new Error(`Recording file missing: ${fileUri}`);
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
      lastError = err;
      onProgress?.({ state: 'failed_retryable', attempt });
      await new Promise<void>((r) => setTimeout(() => r(), 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}
