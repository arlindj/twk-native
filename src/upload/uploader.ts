import * as FileSystem from 'expo-file-system/legacy';
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

export async function uploadRecording(opts: {
  sessionId: string;
  recordingId: string;
  fileUri: string;
  durationMs: number;
  width: number;
  height: number;
  onProgress?: (p: UploadProgress) => void;
  maxAttempts?: number;
}): Promise<RecordingCompletePayload> {
  const { sessionId, recordingId, fileUri, durationMs, width, height, onProgress } = opts;
  const maxAttempts = opts.maxAttempts ?? 4;

  const info = await FileSystem.getInfoAsync(fileUri, { md5: true });
  if (!info.exists) throw new Error(`Recording file missing: ${fileUri}`);
  const fileSizeBytes = info.size ?? 0;
  const checksum = `md5:${info.md5 ?? 'unknown'}`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onProgress?.({ state: 'requesting_url', attempt });
      const { uploadUrl, storageKey } = await getUploadUrl(sessionId, recordingId, fileSizeBytes);

      onProgress?.({ state: 'uploading', attempt });
      const res = await FileSystem.uploadAsync(uploadUrl, fileUri, {
        httpMethod: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Storage upload failed with status ${res.status}`);
      }

      onProgress?.({ state: 'finalizing', attempt });
      const payload: RecordingCompletePayload = {
        recordingId,
        storageKey,
        durationMs,
        checksum,
        fileSizeBytes,
        width,
        height,
      };
      await completeRecording(sessionId, payload);

      onProgress?.({ state: 'done', attempt });
      // Only now is the local copy safe to delete.
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      return payload;
    } catch (err) {
      lastError = err;
      onProgress?.({ state: 'failed_retryable', attempt });
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}
