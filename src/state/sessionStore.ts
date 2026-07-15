import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, PermissionsAndroid, PixelRatio, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { create } from 'zustand';
import { APP_VERSION as BUILD_VERSION, DEVICE_MODEL, LAUNCH_ID } from '../constants';
import * as api from '../api/client';
import * as SecureStore from '../native/secureStore';
import { clearQueue, drain, initQueue, track } from '../events/eventQueue';
import {
  clearAnswersOutbox,
  drainAnswers,
  enqueueAnswers,
  initAnswersOutbox,
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
import { RecordingFileMissingError, uploadRecording, UploadProgress } from '../upload/uploader';
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

/** Rejects if `p` does not settle within `ms` — used to bound native calls. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

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
  pendingSegments: FinishedRecording[];
  lostSegments: number;
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
];

interface SessionState {
  phase: Phase;
  error?: string;
  bootstrap?: BootstrapPayload;
  sessionId?: string;
  /** Test token this session was started from — anchors crash recovery. */
  testToken?: string;
  currentTaskIndex: number;
  /** Questions pending for the current checkpoint (task or post-test). */
  pendingQuestions: QuestionBlock[];
  answers: AnswerPayload[];
  participantProfile?: ParticipantProfile;
  recordingEnabled: boolean;
  /** True while the recorder is starting/stopping a segment. */
  taskBusy: boolean;
  uploadProgress?: SegmentedUploadProgress;
  /** Finished, not-yet-uploaded recording segments (in order). */
  pendingSegments: FinishedRecording[];
  /** Segments that could not be saved/uploaded — surfaced to the participant. */
  lostSegments: number;
  /** Phase to return to after an interruption. */
  interruptedFrom?: Phase;

  resolveFromToken: (testToken: string, apiOverride?: string) => Promise<void>;
  acceptConsent: () => Promise<void>;
  submitIntake: (fields: Omit<ParticipantProfile, 'participantId'>) => Promise<void>;
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
  reset: () => void;
}

/** After consent (and optional intake), enter recording permission or first task. */
function advancePastIntake(set: (partial: Partial<SessionState>) => void, bootstrap: BootstrapPayload) {
  if (bootstrap.recordingRequired) {
    set({ phase: 'permission' });
  } else {
    set({ phase: 'task_intro', recordingEnabled: false });
  }
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

function persistSnapshot(s: SessionState) {
  if (!s.sessionId || !s.testToken || !RESUMABLE_PHASES.includes(s.phase)) return;
  const snap: SessionSnapshot = {
    testToken: s.testToken,
    sessionId: s.sessionId,
    apiBase: api.getApiBase(),
    phase: s.phase === 'interrupted' ? (s.interruptedFrom ?? 'task_intro') : s.phase,
    currentTaskIndex: s.currentTaskIndex,
    recordingEnabled: s.recordingEnabled,
    pendingSegments: s.pendingSegments,
    lostSegments: s.lostSegments,
  };
  void AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
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
  taskBusy: false,
  participantProfile: undefined,
  pendingSegments: [],
  lostSegments: 0,

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
        const lostSegments = snap.lostSegments + (snap.pendingSegments.length - pendingSegments.length);
        const task = bootstrap.tasks[snap.currentTaskIndex];
        const pendingQuestions =
          snap.phase === 'task_questions' && task
            ? questionsForTask(bootstrap, task.id)
            : snap.phase === 'post_questions'
              ? postTestQuestions(bootstrap)
              : [];
        track('test_resumed', { meta: { toPhase: snap.phase, coldStart: true } });

        const midTest = ['task_intro', 'testing', 'task_questions', 'post_questions'].includes(snap.phase);
        const uploadPhase = snap.phase === 'uploading' || snap.phase === 'upload_failed';
        set({
          bootstrap,
          sessionId: snap.sessionId,
          testToken,
          currentTaskIndex: snap.currentTaskIndex,
          recordingEnabled: snap.recordingEnabled,
          pendingSegments,
          lostSegments,
          pendingQuestions,
          answers: [],
          phase: midTest ? 'interrupted' : uploadPhase ? 'upload_failed' : snap.phase,
          interruptedFrom: midTest ? snap.phase : undefined,
          error: uploadPhase ? 'The upload was interrupted. Tap retry to finish.' : undefined,
        });
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
      advancePastIntake(set, bootstrap);
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
    advancePastIntake(set, bootstrap);
  },

  /**
   * Recording permission checkpoint. The actual OS consent dialog shows
   * when the first task starts (that's when capture begins) — here we
   * only verify the device can record and reserve the recording slot.
   */
  grantRecording: async () => {
    const { sessionId } = get();
    if (!sessionId) return;
    await requestNotificationPermission();
    const available = await recorderAvailable();
    if (!available) {
      // Simulator or device without recording support.
      set({ phase: 'permission_denied', error: 'recording_unavailable' });
      return;
    }
    try {
      await api.startRecordingSlot(sessionId);
    } catch {
      // Slot reservation also rides the event stream; not fatal.
    }
    set({ phase: 'task_intro', recordingEnabled: true, error: undefined });
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
    set({ phase: 'task_intro', recordingEnabled: false, error: undefined });
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
    const { bootstrap, currentTaskIndex, recordingEnabled, pendingSegments, taskBusy } = get();
    const task = bootstrap?.tasks[currentTaskIndex];
    if (!task || taskBusy) return;

    // First task (or resume after a stop): start a recording segment.
    // This is the moment the OS consent dialog appears.
    if (recordingEnabled && !isRecordingActive()) {
      set({ taskBusy: true });
      try {
        await startSessionRecording(pendingSegments.length);
      } catch {
        set({ taskBusy: false, phase: 'permission_denied', error: 'permission_denied' });
        return;
      }
      set({ taskBusy: false });
    }

    track('task_started', { taskId: task.id });
    set({ phase: 'testing' });
  },

  completeTask: async (outcome) => {
    const { bootstrap, currentTaskIndex } = get();
    if (!bootstrap) return;
    const task = bootstrap.tasks[currentTaskIndex];
    if (!task) return;
    track(outcome === 'completed' ? 'task_completed' : 'task_abandoned', { taskId: task.id });

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
        set({ lostSegments: get().lostSegments + 1 });
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
        set({ lostSegments: get().lostSegments + 1 });
        void discardSessionRecording();
      }
    }
    set({ phase: 'interrupted', interruptedFrom: phase });
  },

  /** Continue after an interruption; a fresh segment starts with the next task screen. */
  resumeTest: async () => {
    const { interruptedFrom, recordingEnabled, pendingSegments } = get();
    const returnTo = interruptedFrom ?? 'task_intro';
    track('test_resumed', { meta: { toPhase: returnTo } });

    // Mid-task resume needs the recorder running again before the
    // prototype shows; Android will show the consent dialog again
    // (OS requirement — one consent per projection session).
    if (returnTo === 'testing' && recordingEnabled) {
      try {
        await startSessionRecording(pendingSegments.length);
      } catch {
        set({ phase: 'permission_denied', error: 'permission_denied', interruptedFrom: undefined });
        return;
      }
    }
    set({ phase: returnTo, interruptedFrom: undefined });
  },

  finishSession: async () => {
    const { sessionId, bootstrap } = get();
    if (!sessionId || !bootstrap) return;
    set({ phase: 'uploading', uploadProgress: undefined });

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

      const { width, height } = Dimensions.get('screen');
      // Upload segments in order; successfully uploaded ones leave the
      // pending list so a retry never re-uploads them.
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
          if (err instanceof RecordingFileMissingError) {
            // The file is gone for good (cache evicted / crash orphaned
            // it) — retrying forever would strand the participant here.
            track('recording_discarded', {
              meta: { segment: seg.segment, reason: 'file_missing' },
            });
            set({
              pendingSegments: get().pendingSegments.slice(1),
              lostSegments: get().lostSegments + 1,
            });
            continue;
          }
          throw err;
        }
        set({ pendingSegments: get().pendingSegments.slice(1) });
        track('recording_uploaded', { meta: { segment: seg.segment } });
      }
      setUploadState('uploaded');

      // Answers first (values), then the event stream (their mirror).
      await drainAnswers();
      track('session_completed');
      await drain();
      await api.completeSession(sessionId);
      await clearQueue();
      await clearAnswersOutbox();
      clearSnapshot();
      set({ phase: 'done' });
    } catch (err) {
      setUploadState('failed_retryable');
      set({
        phase: 'upload_failed',
        error: err instanceof Error ? err.message : 'Upload failed.',
      });
    }
  },

  retryUpload: async () => {
    await get().finishSession();
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
      taskBusy: false,
      uploadProgress: undefined,
      pendingSegments: [],
      lostSegments: 0,
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
