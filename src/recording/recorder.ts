import ScreenRecorder from '../../modules/screen-recorder';
import { markRecordingStarted, markRecordingStopped, track } from '../events/eventQueue';
import { RecordingState } from '../types';

/**
 * Screen Recorder facade — wraps the native module in the recording
 * state machine from the product documentation, and anchors the event
 * timeline (recording_started / recording_stopped) so tap markers can
 * be synchronized with the video during replay.
 */

let state: RecordingState = 'idle';
let startedAtMs = 0;
const listeners = new Set<(s: RecordingState) => void>();

function setState(next: RecordingState) {
  state = next;
  listeners.forEach((l) => l(next));
}

export function getRecordingState() {
  return state;
}

export function onRecordingState(listener: (s: RecordingState) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function recorderAvailable(): Promise<boolean> {
  try {
    return await ScreenRecorder.isAvailable();
  } catch {
    return false;
  }
}

/** Starts recording; throws when the user denies the OS permission. */
export async function startSessionRecording(): Promise<void> {
  setState('preparing');
  try {
    setState('permission_required');
    await ScreenRecorder.startRecording();
    startedAtMs = Date.now();
    markRecordingStarted();
    track('recording_started');
    setState('recording');
  } catch (err) {
    setState('idle');
    throw err;
  }
}

export interface FinishedRecording {
  fileUri: string;
  durationMs: number;
}

export async function stopSessionRecording(): Promise<FinishedRecording> {
  setState('stopping');
  try {
    const fileUri = await ScreenRecorder.stopRecording();
    const durationMs = Date.now() - startedAtMs;
    track('recording_stopped', { meta: { durationMs } });
    markRecordingStopped();
    setState('upload_pending');
    return { fileUri, durationMs };
  } catch (err) {
    markRecordingStopped();
    setState('failed_retryable');
    throw err;
  }
}

export async function discardSessionRecording(): Promise<void> {
  try {
    await ScreenRecorder.discardRecording();
  } finally {
    markRecordingStopped();
    setState('idle');
  }
}

export function setUploadState(s: Extract<RecordingState, 'uploading' | 'uploaded' | 'failed_retryable' | 'failed_final'>) {
  setState(s);
}
