import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, PermissionsAndroid, PixelRatio, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { create } from 'zustand';
import { APP_VERSION as BUILD_VERSION, DEVICE_MODEL, LAUNCH_ID } from '../constants';
import * as api from '../api/client';
import * as SecureStore from '../native/secureStore';
import {
  clearQueue,
  drain,
  initQueue,
  lastFlushError,
  sessionElapsedMs,
  track,
} from '../events/eventQueue';
import {
  clearAnswersOutbox,
  drainAnswers,
  enqueueAnswers,
  initAnswersOutbox,
  lastAnswersError,
} from './answersOutbox';
import {
  discardSessionRecording,
  FinishedRecording,
  isRecordingActive,
  recorderAvailable,
  setUploadState,
  startSessionRecording,
  stopSessionRecording,
} from '../recording/recorder';
import {
  RecordingFileMissingError,
  RecordingTooLargeError,
  segmentSizeBytes,
  uploadRecording,
  UploadProgress,
} from '../upload/uploader';
import {
  describeFailure,
  diagnosticsNote,
  type FailureMessage,
  type LostSegmentReason,
} from '../lib/failureMessages';
import { connectionInfo } from '../lib/connectivity';
import { withTimeout } from '../lib/retry';
import { isSessionFinalized, writeSessionDiagnostics } from '../lib/synthClient';
import {
  AnswerPayload,
  BootstrapPayload,
  DeviceContext,
  ParticipantProfile,
  QuestionBlock,
} from '../types';

/**
 * Participant runtime state machine.
 *
 * resolving -> consent -> intake -> permission -> task_intro <-> testing
 * -> questions (per task) -> post_questions -> uploading -> done
 * Error phases: link_error, incompatible, permission_denied, upload_failed.
 * Interruption: leaving the app mid-test stops the recording segment and
 * parks the session in `interrupted` until the participant resumes.
 *
 * Recording window: only the testing part. The first segment starts when
 * the participant begins task 1 (that's when the OS consent dialog shows),
 * and recording stops right after the last task completes — intake,
 * consent and post-test questions are never recorded.
 *
 * Crash recovery: a small snapshot (session id, phase, segment file uris)
 * is persisted on every transition. Re-opening the same test link after a
 * cold kill restores the session token from the keychain, re-fetches the
 * bootstrap and resumes instead of minting a duplicate session.
 */
export type Phase =
  | 'idle'
  | 'resolving'
  | 'link_error'
  | 'incompatible'
  | 'consent'
  | 'intake'
  | 'permission'
  | 'permission_denied'
  | 'task_intro'
  | 'testing'
  | 'task_questions'
  | 'post_questions'
  | 'interrupted'
  | 'uploading'
  | 'upload_failed'
  /**
   * Results are in; only the video is left, and sending it right now would
   * spend a noticeable amount of the participant's mobile data. Asking is only
   * possible because the answers no longer depend on this upload.
   */
  | 'upload_metered'
  | 'done';

export const APP_VERSION = BUILD_VERSION;

const SNAPSHOT_KEY = 'twk_session_snapshot_v1';

function deviceLocale(): string {
  try {
    // Hermes ships Intl on both platforms in RN 0.86.
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
}

export function deviceContext(): DeviceContext {
  const { width, height } = Dimensions.get('screen');
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    osVersion: String(Platform.Version),
    model: DEVICE_MODEL,
    screenWidth: Math.round(width),
    screenHeight: Math.round(height),
    pixelRatio: PixelRatio.get(),
    appVersion: APP_VERSION,
    locale: deviceLocale(),
  };
}

/**
 * Whether a `?api=` override points at a local / private-network address.
 *
 * The override is a QA affordance and is always honored in debug builds.
 * In release builds a crafted QR must not be able to redirect the evidence
 * stream (video, name, taps) to an attacker-controlled *public* server — but
 * pointing a real device at a dev server on the same LAN is exactly how the
 * app is tested before the production backend exists. So in release we honor
 * the override only when the target is loopback / link-local / RFC-1918
 * private space, which an off-network attacker cannot reach anyway.
 */
export function isLocalApiTarget(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
    const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // link-local
    return false;
  } catch {
    return false;
  }
}

/** True when this build may adopt `apiOverride` as its backend. */
function mayUseApiOverride(apiOverride: string): boolean {
  return __DEV__ || isLocalApiTarget(apiOverride);
}

/**
 * Above this, sending the video over a connection the OS calls expensive is
 * worth asking about rather than assuming. At the recorder's measured
 * ~2.4 MiB/min a 15 MB segment is roughly a six-minute test — short sessions
 * still upload silently, which is the common case.
 */
const METERED_PROMPT_BYTES = 15 * 1024 * 1024;

/**
 * Android 13+ drops the recording foreground-service notification unless
 * the runtime notification permission was granted. Denial is not fatal —
 * recording works, the persistent indicator is just hidden.
 */
async function requestNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    /* never block the flow on this */
  }
}

/**
 * Microphone permission for think-aloud audio. On Android the runtime
 * RECORD_AUDIO grant is required before the recorder can capture audio; a
 * denial is not fatal — the segment records video only. On iOS ReplayKit
 * asks for the mic inside its own consent dialog when recording starts, so
 * there is nothing to request up front (returns true = "let ReplayKit ask").
 */
async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export interface SegmentedUploadProgress extends UploadProgress {
  /** 1-based segment being uploaded and the total count. */
  segment: number;
  totalSegments: number;
}

interface SessionSnapshot {
  testToken: string;
  sessionId: string;
  apiBase: string;
  phase: Phase;
  currentTaskIndex: number;
  recordingEnabled: boolean;
  audioEnabled: boolean;
  screenRecordingConsent: boolean;
  audioRecordingConsent: boolean;
  pendingSegments: FinishedRecording[];
  lostSegments: number;
  lostSegmentReasons: LostSegmentReason[];
  /**
   * Whether answers + beats + finalize already succeeded for this session.
   * Survives a cold kill because `completeSession` must run exactly once —
   * finalize recomputes `real_duration_ms` from `started_at`, so a second call
   * after a slow upload would inflate the participant's measured time-on-task.
   */
  resultsSubmitted: boolean;
}

/** Phases worth resuming after a cold kill. */
const RESUMABLE_PHASES: Phase[] = [
  'consent',
  'intake',
  'permission',
  'task_intro',
  'testing',
  'task_questions',
  'post_questions',
  'interrupted',
  'uploading',
  'upload_failed',
  'upload_metered',
];

interface SessionState {
  phase: Phase;
  error?: string;
  /** Structured, participant-facing description of the last failure. */
  failure?: FailureMessage;
  bootstrap?: BootstrapPayload;
  sessionId?: string;
  /** Test token this session was started from — anchors crash recovery. */
  testToken?: string;
  currentTaskIndex: number;
  /** Questions pending for the current checkpoint (task or post-test). */
  pendingQuestions: QuestionBlock[];
  answers: AnswerPayload[];
  participantProfile?: ParticipantProfile;
  /** Effective screen recording for this session (device can + participant kept it on). */
  recordingEnabled: boolean;
  /** Effective microphone capture for this session (rides screen recording). */
  audioEnabled: boolean;
  /** Participant's consent toggle for screen recording (default on). */
  screenRecordingConsent: boolean;
  /** Participant's consent toggle for think-aloud audio (default on). */
  audioRecordingConsent: boolean;
  /** True while the recorder is starting/stopping a segment. */
  taskBusy: boolean;
  uploadProgress?: SegmentedUploadProgress;
  /** Finished, not-yet-uploaded recording segments (in order). */
  pendingSegments: FinishedRecording[];
  /** Segments that could not be saved/uploaded — surfaced to the participant. */
  lostSegments: number;
  /**
   * Why each lost segment was dropped, so the done screen can name the cause
   * instead of only counting ("…could not be saved because the video was larger
   * than the server accepts"). Parallel to `lostSegments`, not keyed by index —
   * the participant only ever sees the set of distinct reasons.
   */
  lostSegmentReasons: LostSegmentReason[];
  /**
   * True once the answers, task outcomes and beats are on the server and the
   * session row is finalized. From this point the screen recording is the only
   * thing outstanding, which is what lets the upload screen tell the truth
   * ("your answers are already submitted") and lets the participant walk away
   * from a stubborn video without losing the session.
   */
  resultsSubmitted: boolean;
  /** Re-entrancy guard for finishSession — see the comment on the action. */
  submitting: boolean;
  /** Total bytes still to upload, for the metered-connection prompt. */
  pendingUploadBytes?: number;
  /** Participant chose to send the video over an expensive connection anyway. */
  meteredUploadApproved: boolean;
  /** Parked in `upload_metered`, watching for Wi-Fi to appear. */
  waitingForWifi: boolean;
  /** Phase to return to after an interruption. */
  interruptedFrom?: Phase;
  /** sessionElapsedMs() when the current task started — for its outcome's duration_ms. */
  taskStartedAtMs?: number;

  resolveFromToken: (testToken: string, apiOverride?: string) => Promise<void>;
  acceptConsent: () => Promise<void>;
  submitIntake: (fields: Omit<ParticipantProfile, 'participantId'>) => Promise<void>;
  setScreenRecordingConsent: (on: boolean) => void;
  setAudioRecordingConsent: (on: boolean) => void;
  grantRecording: () => Promise<void>;
  skipRecordingUnavailable: () => void;
  /** Step back through the pre-test setup phases (consent → intake → permission). */
  back: () => void;
  beginTask: () => Promise<void>;
  completeTask: (outcome: 'completed' | 'abandoned') => Promise<void>;
  submitAnswers: (answers: AnswerPayload[]) => Promise<void>;
  handleAppState: (next: 'active' | 'background' | 'inactive') => Promise<void>;
  resumeTest: () => Promise<void>;
  finishSession: () => Promise<void>;
  retryUpload: () => Promise<void>;
  /**
   * Give up on the still-pending recording segments and finish anyway.
   * Offered when the failure is provably permanent (an oversize video) and,
   * now that the results are submitted first, whenever the participant simply
   * cannot get the video out — "Try again" forever is not a real option to
   * offer someone who has already done the work.
   */
  finishWithoutRecording: () => Promise<void>;
  /** Send the video over the expensive connection after all. */
  uploadOverMeteredConnection: () => Promise<void>;
  /** Park until Wi-Fi appears, then upload automatically. */
  waitForWifiThenUpload: () => void;
  reset: () => void;
}

/**
 * After consent (and optional intake), enter the recording permission
 * checkpoint or go straight to the first task. Screen recording is
 * requested only when the study asks for it AND the participant kept the
 * consent toggle on — opting out skips the checkpoint and runs the session
 * without video (taps, events and answers are still full evidence).
 */
function advancePastIntake(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
  bootstrap: BootstrapPayload,
) {
  if (bootstrap.recordingRequired && get().screenRecordingConsent) {
    set({ phase: 'permission' });
  } else {
    if (bootstrap.recordingRequired) {
      track('recording_skipped', { meta: { reason: 'user_opted_out' } });
    }
    set({ phase: 'task_intro', recordingEnabled: false, audioEnabled: false });
  }
}

type SetSession = (partial: Partial<SessionState>) => void;
type GetSession = () => SessionState;

/**
 * Parks the session and asks before spending the participant's mobile data.
 * Returns true when it parked (the caller must stop).
 *
 * This is only defensible because the results are already submitted by the time
 * it runs: the study has its data, so waiting for Wi-Fi costs nothing but the
 * video. Asking before that reordering would have meant holding the whole
 * session hostage to a connectivity preference.
 */
async function maybeAskAboutMeteredUpload(set: SetSession, get: GetSession): Promise<boolean> {
  if (get().meteredUploadApproved) return false;
  const conn = await connectionInfo();
  if (!conn.expensive) return false;

  let bytes = 0;
  for (const seg of get().pendingSegments) bytes += await segmentSizeBytes(seg.fileUri);
  if (bytes < METERED_PROMPT_BYTES) return false;

  track('recording_upload_deferred', {
    meta: { reason: 'metered_connection', bytes, connectionType: conn.type },
  });
  set({ phase: 'upload_metered', pendingUploadBytes: bytes, waitingForWifi: false });
  return true;
}

/**
 * Uploads every pending segment in order. Successfully uploaded segments leave
 * the pending list, so a retry never re-sends one that already landed.
 */
async function uploadPendingSegments(set: SetSession, get: GetSession, sessionId: string) {
  const { width, height } = Dimensions.get('screen');
  const totalSegments = get().pendingSegments.length;

  while (get().pendingSegments.length > 0) {
    const seg = get().pendingSegments[0];
    setUploadState('uploading');
    try {
      await uploadRecording({
        sessionId,
        recordingId: `rec_${sessionId}_s${seg.segment}`,
        fileUri: seg.fileUri,
        durationMs: seg.durationMs,
        segment: seg.segment,
        width: Math.round(width * PixelRatio.get()),
        height: Math.round(height * PixelRatio.get()),
        onProgress: (p) =>
          set({ uploadProgress: { ...p, segment: seg.segment + 1, totalSegments } }),
      });
    } catch (err) {
      // Two permanently-unsendable cases. Both drop the segment and carry on:
      // the results are already submitted, so one video that can never be sent
      // must not turn into a dead end. DoneScreen reports the gap honestly via
      // `lostSegments`, and `diagnosticsNote` carries the reason to the server.
      const terminal =
        err instanceof RecordingFileMissingError
          ? 'file_missing'
          : err instanceof RecordingTooLargeError
            ? 'too_large'
            : null;
      if (terminal) {
        track('recording_discarded', {
          meta: {
            segment: seg.segment,
            reason: terminal,
            ...(err instanceof RecordingTooLargeError ? { fileSizeBytes: err.fileSizeBytes } : {}),
          },
        });
        set({
          pendingSegments: get().pendingSegments.slice(1),
          lostSegments: get().lostSegments + 1,
          lostSegmentReasons: [...get().lostSegmentReasons, terminal],
        });
        continue;
      }
      throw err;
    }
    set({ pendingSegments: get().pendingSegments.slice(1) });
    track('recording_uploaded', { meta: { segment: seg.segment } });
  }
  setUploadState('uploaded');
}

/**
 * Last step: record why the evidence is incomplete (if it is), release the
 * local queues, and show the done screen.
 *
 * The queues are cleared only from here, and only after delivery was actually
 * confirmed — clearing them is destructive and used to happen unconditionally.
 */
async function concludeSession(set: SetSession, get: GetSession, sessionId: string) {
  const note = diagnosticsNote(get().lostSegments, get().lostSegmentReasons);
  if (note) await writeSessionDiagnostics(sessionId, note);
  await clearQueue();
  await clearAnswersOutbox();
  clearSnapshot();
  set({
    phase: 'done',
    uploadProgress: undefined,
    waitingForWifi: false,
    meteredUploadApproved: false,
    pendingUploadBytes: undefined,
  });
}

function questionsForTask(bootstrap: BootstrapPayload, taskId: string) {
  return bootstrap.questionBlocks.filter((q) => q.afterTaskId === taskId);
}

function postTestQuestions(bootstrap: BootstrapPayload) {
  return bootstrap.questionBlocks.filter((q) => !q.afterTaskId);
}

function toPath(fileUri: string): string {
  return fileUri.startsWith('file://') ? decodeURI(fileUri.slice('file://'.length)) : fileUri;
}

/** Drops snapshot segments whose files did not survive the restart. */
async function filterExistingSegments(segments: FinishedRecording[]): Promise<FinishedRecording[]> {
  const out: FinishedRecording[] = [];
  for (const seg of segments) {
    if (await ReactNativeBlobUtil.fs.exists(toPath(seg.fileUri)).catch(() => false)) out.push(seg);
  }
  return out;
}

async function readSnapshot(): Promise<SessionSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as SessionSnapshot) : null;
  } catch {
    return null;
  }
}

/** What an unfinished session left behind, for the welcome screen's resume offer. */
export interface ResumableSession {
  testToken: string;
  phase: Phase;
  /** True when only the screen recording is still outstanding. */
  resultsSubmitted: boolean;
}

/**
 * An unfinished session this device can pick up again, or null.
 *
 * Recovery used to be reachable only by re-opening the invite deep link or
 * re-typing the code: a participant whose app was killed mid-upload landed on
 * the welcome screen with no sign that anything was pending, and the session sat
 * unfinalized on the server. The welcome screen can now offer to continue it.
 */
export async function findResumableSession(): Promise<ResumableSession | null> {
  const snap = await readSnapshot();
  if (!snap || !snap.testToken || !RESUMABLE_PHASES.includes(snap.phase)) return null;
  return {
    testToken: snap.testToken,
    phase: snap.phase,
    resultsSubmitted: snap.resultsSubmitted ?? false,
  };
}

function snapshotOf(s: SessionState): SessionSnapshot | null {
  if (!s.sessionId || !s.testToken || !RESUMABLE_PHASES.includes(s.phase)) return null;
  return {
    testToken: s.testToken,
    sessionId: s.sessionId,
    apiBase: api.getApiBase(),
    phase: s.phase === 'interrupted' ? (s.interruptedFrom ?? 'task_intro') : s.phase,
    currentTaskIndex: s.currentTaskIndex,
    recordingEnabled: s.recordingEnabled,
    audioEnabled: s.audioEnabled,
    screenRecordingConsent: s.screenRecordingConsent,
    audioRecordingConsent: s.audioRecordingConsent,
    pendingSegments: s.pendingSegments,
    lostSegments: s.lostSegments,
    lostSegmentReasons: s.lostSegmentReasons,
    resultsSubmitted: s.resultsSubmitted,
  };
}

/** Fire-and-forget snapshot write — used by the store subscription. */
function persistSnapshot(s: SessionState) {
  const snap = snapshotOf(s);
  if (snap) void AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
}

/**
 * Awaited snapshot write, for the one transition where losing it matters:
 * `resultsSubmitted`. Everything else in the snapshot is a convenience — being
 * a step behind only costs the participant a repeated screen — but a lost
 * `resultsSubmitted` makes a resumed session call finalize a second time and
 * inflate its `real_duration_ms`.
 */
async function persistSnapshotNow(s: SessionState): Promise<void> {
  const snap = snapshotOf(s);
  if (!snap) return;
  try {
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* isSessionFinalized() is the durable backstop on resume */
  }
}

function clearSnapshot() {
  void AsyncStorage.removeItem(SNAPSHOT_KEY);
}

export const useSession = create<SessionState>((set, get) => ({
  phase: 'idle',
  currentTaskIndex: 0,
  pendingQuestions: [],
  answers: [],
  recordingEnabled: false,
  audioEnabled: false,
  screenRecordingConsent: true,
  audioRecordingConsent: true,
  taskBusy: false,
  participantProfile: undefined,
  pendingSegments: [],
  lostSegments: 0,
  lostSegmentReasons: [],
  resultsSubmitted: false,
  submitting: false,
  meteredUploadApproved: false,
  waitingForWifi: false,

  resolveFromToken: async (testToken, apiOverride) => {
    // A new deep link can arrive while a session is mid-flight (user
    // re-scans the QR, taps the link again) — never leak a running
    // recording into the new session.
    if (isRecordingActive()) {
      await discardSessionRecording();
    }
    set({ phase: 'resolving', error: undefined, testToken });
    // The ?api= override is a development affordance. In release builds a
    // crafted QR must never be able to redirect the evidence stream (video,
    // name, taps) to an attacker-controlled *public* server — but a dev
    // server on the same LAN is honored so real-device testing works before
    // the production backend exists (see mayUseApiOverride / isLocalApiTarget).
    if (apiOverride && mayUseApiOverride(apiOverride)) api.setApiBase(apiOverride);

    // Cold-restart recovery: same link + a keychain token for the
    // snapshot's session -> resume it instead of minting a new session.
    const snap = await readSnapshot();
    if (
      snap &&
      snap.testToken === testToken &&
      RESUMABLE_PHASES.includes(snap.phase) &&
      (await api.restoreToken(snap.sessionId))
    ) {
      try {
        if (snap.apiBase && mayUseApiOverride(snap.apiBase)) api.setApiBase(snap.apiBase);
        const bootstrap = await api.fetchBootstrap(snap.sessionId);
        await initQueue(snap.sessionId, APP_VERSION);
        await initAnswersOutbox(snap.sessionId);
        const pendingSegments = await filterExistingSegments(snap.pendingSegments);
        // Segments whose file vanished while the app was dead are lost for the
        // same reason RecordingFileMissingError covers — the OS reclaimed the
        // cache — so they carry that cause into the done screen too.
        const evictedCount = snap.pendingSegments.length - pendingSegments.length;
        const lostSegments = snap.lostSegments + evictedCount;
        const lostSegmentReasons: LostSegmentReason[] = [
          ...(snap.lostSegmentReasons ?? []),
          ...Array.from({ length: Math.max(0, evictedCount) }, () => 'file_missing' as const),
        ];
        const task = bootstrap.tasks[snap.currentTaskIndex];
        const pendingQuestions =
          snap.phase === 'task_questions' && task
            ? questionsForTask(bootstrap, task.id)
            : snap.phase === 'post_questions'
              ? postTestQuestions(bootstrap)
              : [];
        track('test_resumed', { meta: { toPhase: snap.phase, coldStart: true } });

        const midTest = ['task_intro', 'testing', 'task_questions', 'post_questions'].includes(snap.phase);
        const uploadPhase =
          snap.phase === 'uploading' ||
          snap.phase === 'upload_failed' ||
          snap.phase === 'upload_metered';
        // A snapshot written before this field existed has no value for it;
        // `false` is the safe default (submit again — every endpoint upserts).
        // For a session that died during the submit phase, ask the server rather
        // than trusting local storage: the flag is written after finalize
        // returns, so a kill inside that window would otherwise cause a second
        // finalize and inflate `real_duration_ms` by the whole downtime.
        // A failed/offline check returns false, which re-finalizes — the safe
        // direction, since the alternative is a session left `running` forever.
        const resultsSubmitted =
          (snap.resultsSubmitted ?? false) ||
          (uploadPhase && (await isSessionFinalized(snap.sessionId)));
        // Segments whose file vanished while the app was dead can no longer be
        // uploaded, and if the results were already submitted there is nothing
        // left for this session to do — going to `upload_failed` would strand
        // the participant on a retry button that has nothing to retry.
        const nothingLeftToSend = uploadPhase && resultsSubmitted && pendingSegments.length === 0;
        set({
          bootstrap,
          sessionId: snap.sessionId,
          testToken,
          currentTaskIndex: snap.currentTaskIndex,
          recordingEnabled: snap.recordingEnabled,
          audioEnabled: snap.audioEnabled ?? false,
          screenRecordingConsent: snap.screenRecordingConsent ?? true,
          audioRecordingConsent: snap.audioRecordingConsent ?? true,
          pendingSegments,
          lostSegments,
          lostSegmentReasons,
          resultsSubmitted,
          submitting: false,
          meteredUploadApproved: false,
          waitingForWifi: false,
          pendingQuestions,
          answers: [],
          phase: midTest
            ? 'interrupted'
            : nothingLeftToSend
              ? 'done'
              : uploadPhase
                ? 'upload_failed'
                : snap.phase,
          interruptedFrom: midTest ? snap.phase : undefined,
          error: uploadPhase && !nothingLeftToSend
            ? 'The upload was interrupted. Tap retry to finish.'
            : undefined,
        });
        if (nothingLeftToSend) {
          const note = diagnosticsNote(lostSegments, lostSegmentReasons);
          if (note) void writeSessionDiagnostics(snap.sessionId, note);
          void clearQueue();
          void clearAnswersOutbox();
          clearSnapshot();
        }
        return;
      } catch {
        // Expired/invalid session — fall through to a fresh start.
        clearSnapshot();
      }
    }

    try {
      const { sessionId, sessionToken } = await api.startSession(testToken, deviceContext());
      await api.persistToken(sessionId, sessionToken);
      const bootstrap = await api.fetchBootstrap(sessionId);

      // Mobile-only guard: this runtime refuses desktop prototypes.
      if (bootstrap.prototype.platform !== 'mobile_app') {
        set({ phase: 'incompatible', bootstrap, sessionId });
        return;
      }
      // A study without tasks has nothing to run.
      if (bootstrap.tasks.length === 0) {
        set({ phase: 'link_error', error: 'This study has no tasks configured yet.' });
        return;
      }
      // Client-side expiry check — do not start evidence collection for a
      // link the server will 410 halfway through.
      const expiresAt = Date.parse(bootstrap.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        set({ phase: 'link_error', error: 'This test link has expired.' });
        return;
      }

      await initQueue(sessionId, APP_VERSION);
      await initAnswersOutbox(sessionId);
      track('session_started');
      set({
        phase: 'consent',
        bootstrap,
        sessionId,
        currentTaskIndex: 0,
        answers: [],
        pendingSegments: [],
        lostSegments: 0,
        lostSegmentReasons: [],
      });
    } catch (err) {
      const message =
        err instanceof api.ApiError
          ? err.status === 410
            ? 'This test link has expired.'
            : err.message
          : 'Could not reach the server. Check your connection and try again.';
      clearSnapshot();
      set({ phase: 'link_error', error: message });
    }
  },

  acceptConsent: async () => {
    const { bootstrap, sessionId } = get();
    if (!bootstrap || !sessionId) return;
    track('consent_accepted', { meta: { consentVersion: bootstrap.consent.version } });
    try {
      await api.acceptConsent(sessionId, bootstrap.consent.version, LAUNCH_ID);
    } catch {
      // Consent is also in the event stream; do not block the participant.
    }
    if (bootstrap.intake?.enabled) {
      set({ phase: 'intake' });
    } else {
      advancePastIntake(set, get, bootstrap);
    }
  },

  submitIntake: async (fields) => {
    const { bootstrap, sessionId } = get();
    if (!bootstrap || !sessionId) return;
    try {
      const { participantId } = await api.submitParticipantProfile(sessionId, fields);
      const profile: ParticipantProfile = { participantId, ...fields };
      track('participant_profile_submitted', {
        meta: {
          participantId,
          hasFullName: Boolean(fields.fullName),
          hasAge: fields.age != null,
          hasRole: Boolean(fields.role),
        },
      });
      set({ participantProfile: profile });
    } catch {
      // Profile also rides the event stream; do not block the participant.
      const participantId = await api.getGuestParticipantId();
      set({ participantProfile: { participantId, ...fields } });
      track('participant_profile_submitted', {
        meta: { participantId, offline: true },
      });
    }
    advancePastIntake(set, get, bootstrap);
  },

  /** Participant's consent toggles on the "Before you start" screen. */
  setScreenRecordingConsent: (on) => set({ screenRecordingConsent: on }),
  setAudioRecordingConsent: (on) => set({ audioRecordingConsent: on }),

  /**
   * Recording permission checkpoint. The actual OS consent dialog shows
   * when the first task starts (that's when capture begins) — here we
   * only verify the device can record, request the microphone when the
   * participant opted into audio, and reserve the recording slot.
   */
  grantRecording: async () => {
    const { sessionId, audioRecordingConsent } = get();
    if (!sessionId) return;
    await requestNotificationPermission();
    const available = await recorderAvailable();
    if (!available) {
      // Simulator or device without recording support.
      set({ phase: 'permission_denied', error: 'recording_unavailable' });
      return;
    }
    // Think-aloud audio rides the screen-recording session. Ask for the OS
    // mic permission only when the participant kept audio on; a denial just
    // drops audio for the session — screen recording still proceeds.
    const audioEnabled = audioRecordingConsent ? await requestMicPermission() : false;
    try {
      await api.startRecordingSlot(sessionId);
    } catch {
      // Slot reservation also rides the event stream; not fatal.
    }
    set({ phase: 'task_intro', recordingEnabled: true, audioEnabled, error: undefined });
  },

  /**
   * Production fallback out of the recording dead end: when the device
   * cannot record (or the participant keeps denying the OS dialog), the
   * session continues without video — taps, events and answers are still
   * full evidence. The session is flagged so the dashboard shows it had
   * no recording.
   */
  skipRecordingUnavailable: () => {
    track('recording_skipped', { meta: { reason: get().error ?? 'unknown' } });
    set({ phase: 'task_intro', recordingEnabled: false, audioEnabled: false, error: undefined });
  },

  /**
   * Back navigation across the pre-test setup screens only. Once a task has
   * started (task_intro onward) going back would mean discarding a recording,
   * which is the explicit "leave the test" action instead — so `back` is a
   * no-op there. Re-submitting consent/intake afterwards is idempotent.
   */
  back: () => {
    const { phase, bootstrap } = get();
    if (phase === 'intake') {
      set({ phase: 'consent' });
    } else if (phase === 'permission' || phase === 'permission_denied') {
      set({ phase: bootstrap?.intake?.enabled ? 'intake' : 'consent', error: undefined });
    }
  },

  beginTask: async () => {
    const { bootstrap, currentTaskIndex, recordingEnabled, audioEnabled, pendingSegments, taskBusy } = get();
    const task = bootstrap?.tasks[currentTaskIndex];
    if (!task || taskBusy) return;

    // First task (or resume after a stop): start a recording segment.
    // This is the moment the OS consent dialog appears.
    if (recordingEnabled && !isRecordingActive()) {
      set({ taskBusy: true });
      try {
        await startSessionRecording(pendingSegments.length, audioEnabled);
      } catch {
        set({ taskBusy: false, phase: 'permission_denied', error: 'permission_denied' });
        return;
      }
      set({ taskBusy: false });
    }

    track('task_started', { taskId: task.id });
    set({ phase: 'testing', taskStartedAtMs: sessionElapsedMs() });
  },

  completeTask: async (outcome) => {
    const { bootstrap, currentTaskIndex, taskStartedAtMs } = get();
    if (!bootstrap) return;
    const task = bootstrap.tasks[currentTaskIndex];
    if (!task) return;
    track(outcome === 'completed' ? 'task_completed' : 'task_abandoned', { taskId: task.id });
    // Durable, retried delivery (same outbox as question answers) of this
    // mission's outcome — sendAnswers recognizes the __kind sentinel and
    // posts it to synth's session_prompt_outcomes instead of an answer.
    await enqueueAnswers([
      {
        questionId: task.id,
        taskId: task.id,
        type: 'context_screen',
        value: JSON.stringify({
          __kind: 'mission_outcome',
          outcome,
          durationMs: sessionElapsedMs() - (taskStartedAtMs ?? sessionElapsedMs()),
        }),
        answeredAtMs: sessionElapsedMs(),
      },
    ]);

    // Last task done — stop recording NOW so post-test questions are
    // never part of the video.
    const isLastTask = currentTaskIndex === bootstrap.tasks.length - 1;
    if (isLastTask && isRecordingActive()) {
      try {
        const segment = await withTimeout(
          stopSessionRecording(),
          20000,
          'Recording did not stop in time.',
        );
        set({ pendingSegments: [...get().pendingSegments, segment] });
      } catch {
        // Segment lost (system-level failure); the session continues —
        // events and answers are still full evidence. Flag it so the
        // participant and the dashboard both know.
        track('recording_discarded', {
          meta: { segment: get().pendingSegments.length, reason: 'stop_failed' },
        });
        set({
          lostSegments: get().lostSegments + 1,
          lostSegmentReasons: [...get().lostSegmentReasons, 'stop_failed'],
        });
        void discardSessionRecording();
      }
    }

    const taskQuestions = questionsForTask(bootstrap, task.id);
    if (taskQuestions.length > 0) {
      set({ phase: 'task_questions', pendingQuestions: taskQuestions });
    } else {
      await get().submitAnswers([]);
    }
  },

  submitAnswers: async (newAnswers) => {
    const { bootstrap, sessionId, currentTaskIndex, answers, phase } = get();
    if (!bootstrap || !sessionId) return;

    for (const a of newAnswers) {
      // The full value rides the event stream too — if the answers
      // endpoint is unreachable for the whole session, nothing is lost.
      track('question_answered', {
        taskId: a.taskId,
        meta: {
          questionId: a.questionId,
          answerType: a.type,
          value: JSON.stringify(a.value).slice(0, 2000),
        },
      });
    }
    const all = [...answers, ...newAnswers];
    set({ answers: all });
    // Durable outbox: persisted before the network attempt, retried on a
    // timer and drained at session end.
    await enqueueAnswers(newAnswers);

    if (phase === 'post_questions') {
      await get().finishSession();
      return;
    }

    const nextIndex = currentTaskIndex + 1;
    if (nextIndex < bootstrap.tasks.length) {
      set({ currentTaskIndex: nextIndex, phase: 'task_intro', pendingQuestions: [] });
    } else {
      const post = postTestQuestions(bootstrap);
      if (post.length > 0) {
        set({ phase: 'post_questions', pendingQuestions: post });
      } else {
        await get().finishSession();
      }
    }
  },

  /**
   * App lifecycle. Leaving the app mid-test stops the recording segment
   * immediately: on Android, MediaProjection would otherwise keep
   * capturing OTHER apps (privacy), and on iOS ReplayKit freezes anyway.
   * The session parks in `interrupted` and resumes where it left off.
   */
  handleAppState: async (next) => {
    if (next === 'active') {
      track('app_foregrounded');
      return;
    }
    if (next !== 'background') return; // 'inactive' = call overlay / shade — recording keeps running
    track('app_backgrounded');

    const { phase } = get();
    // Backgrounding during the submit phase must NOT tear anything down. On iOS
    // the JS thread is suspended here, which is exactly why the PUT asks UIKit
    // for background execution time (uploader's IOSBackgroundTask); killing the
    // transfer instead would strand a file that was already half sent. The
    // event is still recorded so a truncated upload is explainable afterwards.
    if (phase === 'uploading' || phase === 'upload_failed' || phase === 'upload_metered') {
      track('test_interrupted', { meta: { fromPhase: phase, duringSubmit: true } });
      return;
    }

    const midTest = phase === 'testing' || phase === 'task_intro' || phase === 'task_questions';
    if (!midTest) return;

    track('test_interrupted', { meta: { fromPhase: phase } });
    if (isRecordingActive()) {
      try {
        const segment = await withTimeout(stopSessionRecording(), 10000, 'stop timeout');
        set({ pendingSegments: [...get().pendingSegments, segment] });
      } catch {
        track('recording_discarded', {
          meta: { segment: get().pendingSegments.length, reason: 'stop_failed_background' },
        });
        set({
          lostSegments: get().lostSegments + 1,
          lostSegmentReasons: [...get().lostSegmentReasons, 'stop_failed'],
        });
        void discardSessionRecording();
      }
    }
    set({ phase: 'interrupted', interruptedFrom: phase });
  },

  /** Continue after an interruption; a fresh segment starts with the next task screen. */
  resumeTest: async () => {
    const { interruptedFrom, recordingEnabled, audioEnabled, pendingSegments } = get();
    const returnTo = interruptedFrom ?? 'task_intro';
    track('test_resumed', { meta: { toPhase: returnTo } });

    // Mid-task resume needs the recorder running again before the
    // prototype shows; Android will show the consent dialog again
    // (OS requirement — one consent per projection session).
    if (returnTo === 'testing' && recordingEnabled) {
      try {
        await startSessionRecording(pendingSegments.length, audioEnabled);
      } catch {
        set({ phase: 'permission_denied', error: 'permission_denied', interruptedFrom: undefined });
        return;
      }
    }
    set({ phase: returnTo, interruptedFrom: undefined });
  },

  /**
   * End of session, in the order that matters.
   *
   * The old order was: upload the video, then the answers, then the beats, then
   * finalize. That put the biggest, slowest, most failure-prone step in front of
   * the three cheap steps that actually turn a run into a result — so a dead
   * connection during a 40 MB transfer meant the session was never finalized at
   * all. It stayed `running` in the database, the participant never saw a
   * success page, and the answers they had already given sat on the phone.
   *
   * Now the results go first and the video last. Once `resultsSubmitted` is
   * true, nothing that happens to the video can cost the study its data, which
   * is also what makes it honest to offer "finish without the video" and to ask
   * before spending the participant's mobile data.
   *
   * `submitting` guards re-entry: two overlapping runs (a double-tapped "Try
   * again") would both read `pendingSegments[0]` and upload the same segment
   * twice, and `recordings/start` deletes the stored object before re-signing,
   * so the second run would delete the object the first one was still writing.
   */
  finishSession: async () => {
    const { sessionId, bootstrap, submitting } = get();
    if (!sessionId || !bootstrap) return;
    if (submitting) return;
    set({ submitting: true, phase: 'uploading', uploadProgress: undefined, failure: undefined });

    try {
      // Safety net — recording should already be stopped by completeTask.
      if (isRecordingActive()) {
        const segment = await withTimeout(
          stopSessionRecording(),
          20000,
          'Recording did not stop in time.',
        );
        set({ pendingSegments: [...get().pendingSegments, segment] });
      }

      // ---- 1. The results ---------------------------------------------------
      if (!get().resultsSubmitted) {
        set({ error: undefined });
        // The drains report success as a boolean and keep the data on disk when
        // they fail. That return value used to be discarded, and the code then
        // cleared both stores unconditionally — so a session that lost the
        // network at exactly this point deleted the participant's unsent
        // answers and beats and showed them "Thank you!". Nothing is cleared
        // now unless delivery is confirmed.
        if (!(await drainAnswers())) {
          throw lastAnswersError() ?? new Error('Your answers could not be sent.');
        }
        track('session_completed');
        if (!(await drain())) {
          throw lastFlushError() ?? new Error('Your session data could not be sent.');
        }
        // Exactly once per session — finalize recomputes real_duration_ms from
        // started_at, so a second call after a slow upload would bill the
        // upload time to the participant's time-on-task.
        await api.completeSession(sessionId);
        track('session_results_submitted');
        set({ resultsSubmitted: true });
        // Awaited, not fire-and-forget: if the process dies in the window
        // between finalize returning and this write landing, a resumed session
        // would finalize again and bill the dead time to the participant's
        // time-on-task. `isSessionFinalized` on resume covers what a crash
        // inside even this window would miss.
        await persistSnapshotNow(get());
      }

      // ---- 2. The video -----------------------------------------------------
      if (get().pendingSegments.length > 0) {
        const parked = await maybeAskAboutMeteredUpload(set, get);
        if (parked) return;
        await uploadPendingSegments(set, get, sessionId);
      }

      await concludeSession(set, get, sessionId);
    } catch (err) {
      setUploadState('failed_retryable');
      // Keep the raw error, not a pre-flattened string: describeFailure turns it
      // into copy that names the real cause (offline vs. expired session vs.
      // server fault). The context decides whether the copy may reassure the
      // participant that their answers are already safe — after the reorder
      // above, that claim is only true once resultsSubmitted is set.
      set({
        phase: 'upload_failed',
        error: undefined,
        failure: describeFailure(err, get().resultsSubmitted ? 'upload' : 'results'),
      });
    } finally {
      set({ submitting: false });
    }
  },

  retryUpload: async () => {
    await get().finishSession();
  },

  finishWithoutRecording: async () => {
    const { sessionId } = get();
    const dropped = get().pendingSegments;
    if (dropped.length > 0) {
      for (const seg of dropped) {
        track('recording_discarded', {
          meta: { segment: seg.segment, reason: 'user_skipped_unsendable' },
        });
      }
      set({
        pendingSegments: [],
        lostSegments: get().lostSegments + dropped.length,
        // Was hardcoded to 'too_large', which mislabelled every voluntary skip
        // as a server size rejection — including the ones caused by a bad
        // connection. The done screen and the server-side diagnostics both read
        // this, so the wrong reason here is a wrong bug report later.
        lostSegmentReasons: [
          ...get().lostSegmentReasons,
          ...dropped.map(() => 'user_skipped' as const),
        ],
      });
    }
    set({ failure: undefined, error: undefined, waitingForWifi: false });
    // Results already in? Then there is nothing left to send — conclude here
    // rather than re-entering finishSession, which would only find an empty
    // segment list anyway.
    if (get().resultsSubmitted && sessionId) {
      await concludeSession(set, get, sessionId);
      return;
    }
    await get().finishSession();
  },

  uploadOverMeteredConnection: async () => {
    set({ meteredUploadApproved: true, waitingForWifi: false });
    await get().finishSession();
  },

  waitForWifiThenUpload: () => {
    // Stays in `upload_metered`; UploadScreen watches connectivity and calls
    // finishSession the moment an unmetered connection appears. Kept in the UI
    // rather than the store so the subscription dies with the screen instead of
    // outliving the session.
    set({ waitingForWifi: true });
  },

  reset: () => {
    void discardSessionRecording();
    void clearQueue();
    void clearAnswersOutbox();
    clearSnapshot();
    void SecureStore.deleteItem('twk_session_token');
    set({
      phase: 'idle',
      error: undefined,
      bootstrap: undefined,
      sessionId: undefined,
      testToken: undefined,
      currentTaskIndex: 0,
      pendingQuestions: [],
      answers: [],
      participantProfile: undefined,
      recordingEnabled: false,
      audioEnabled: false,
      screenRecordingConsent: true,
      audioRecordingConsent: true,
      taskBusy: false,
      uploadProgress: undefined,
      pendingSegments: [],
      lostSegments: 0,
      lostSegmentReasons: [],
      resultsSubmitted: false,
      submitting: false,
      meteredUploadApproved: false,
      waitingForWifi: false,
      pendingUploadBytes: undefined,
      failure: undefined,
      interruptedFrom: undefined,
    });
  },
}));

// Crash-recovery snapshot: persisted on every relevant transition,
// removed once the session leaves the resumable window.
useSession.subscribe((s) => {
  if (s.phase === 'idle' || s.phase === 'done' || s.phase === 'link_error' || s.phase === 'incompatible') {
    clearSnapshot();
    return;
  }
  persistSnapshot(s);
});
