import ScreenRecorder from '../../modules/screen-recorder';
import { markRecordingStarted, markRecordingStopped, track } from '../events/eventQueue';
import { RecordingState } from '../types';

/**
 * Screen Recorder facade — wraps the native module in the recording
 * state machine from the product documentation, and anchors the event
 * timeline (recording_started / recording_stopped) so tap markers can
 * be synchronized with the video during replay.
 *
 * Recording is segmented: it covers only the task-testing window, and a
 * session can produce several segments — recording stops the moment the
 * participant leaves the app mid-test (privacy) and a fresh segment
 * starts when they resume. Every segment is a standalone .mp4.
 */

let state: RecordingState = 'idle';
let startedAtMs = 0;
let segmentIndex = -1;

function setState(next: RecordingState) {
  state = next;
}

export function isRecordingActive() {
  return state === 'recording';
}

export async function recorderAvailable(): Promise<boolean> {
  try {
    return await ScreenRecorder.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Starts a new recording segment; throws when the user denies the OS
 * permission. `segment` is the 0-based index (segments recorded so far).
 */
export async function startSessionRecording(segment: number): Promise<void> {
  setState('preparing');
  try {
    setState('permission_required');
    await ScreenRecorder.startRecording();
    startedAtMs = Date.now();
    segmentIndex = segment;
    markRecordingStarted(segment);
    track('recording_started', { meta: { segment } });
    setState('recording');
  } catch (err) {
    setState('idle');
    throw err;
  }
}

export interface FinishedRecording {
  fileUri: string;
  durationMs: number;
  segment: number;
}

export async function stopSessionRecording(): Promise<FinishedRecording> {
  setState('stopping');
  const segment = segmentIndex;
  try {
    const fileUri = await ScreenRecorder.stopRecording();
    const durationMs = Date.now() - startedAtMs;
    track('recording_stopped', { meta: { durationMs, segment } });
    markRecordingStopped();
    setState('upload_pending');
    return { fileUri, durationMs, segment };
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

export function setUploadState(
  s: Extract<RecordingState, 'uploading' | 'uploaded' | 'failed_retryable' | 'failed_final'>,
) {
  setState(s);
}
