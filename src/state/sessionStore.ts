import { Dimensions, PixelRatio, Platform } from 'react-native';
import { create } from 'zustand';
import { APP_VERSION as BUILD_VERSION, DEVICE_MODEL, LAUNCH_ID } from '../constants';
import * as api from '../api/client';
import { clearQueue, drain, initQueue, track } from '../events/eventQueue';
import {
  discardSessionRecording,
  FinishedRecording,
  isRecordingActive,
  recorderAvailable,
  setUploadState,
  startSessionRecording,
  stopSessionRecording,
} from '../recording/recorder';
import { uploadRecording, UploadProgress } from '../upload/uploader';
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
    locale: 'en',
  };
}

/** Rejects if `p` does not settle within `ms` — used to bound native calls. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export interface SegmentedUploadProgress extends UploadProgress {
  /** 1-based segment being uploaded and the total count. */
  segment: number;
  totalSegments: number;
}

interface SessionState {
  phase: Phase;
  error?: string;
  bootstrap?: BootstrapPayload;
  sessionId?: string;
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
  /** Phase to return to after an interruption. */
  interruptedFrom?: Phase;

  resolveFromToken: (testToken: string, apiOverride?: string) => Promise<void>;
  acceptConsent: () => Promise<void>;
  submitIntake: (fields: Omit<ParticipantProfile, 'participantId'>) => Promise<void>;
  grantRecording: () => Promise<void>;
  skipRecordingUnavailable: () => void;
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

export const useSession = create<SessionState>((set, get) => ({
  phase: 'idle',
  currentTaskIndex: 0,
  pendingQuestions: [],
  answers: [],
  recordingEnabled: false,
  taskBusy: false,
  participantProfile: undefined,
  pendingSegments: [],

  resolveFromToken: async (testToken, apiOverride) => {
    // A new deep link can arrive while a session is mid-flight (user
    // re-scans the QR, taps the link again) — never leak a running
    // recording into the new session.
    if (isRecordingActive()) {
      await discardSessionRecording();
    }
    set({ phase: 'resolving', error: undefined });
    if (apiOverride) api.setApiBase(apiOverride);
    try {
      const { sessionId, sessionToken } = await api.startSession(testToken, deviceContext());
      await api.persistToken(sessionId, sessionToken);
      const bootstrap = await api.fetchBootstrap(sessionId);

      // Mobile-only guard: this runtime refuses desktop prototypes.
      if (bootstrap.prototype.platform !== 'mobile_app') {
        set({ phase: 'incompatible', bootstrap, sessionId });
        return;
      }

      await initQueue(sessionId, APP_VERSION);
      track('session_started');
      set({ phase: 'consent', bootstrap, sessionId, currentTaskIndex: 0, answers: [], pendingSegments: [] });
    } catch (err) {
      const message =
        err instanceof api.ApiError
          ? err.status === 410
            ? 'This test link has expired.'
            : err.message
          : 'Could not reach the server. Check your connection and try again.';
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

  skipRecordingUnavailable: () => {
    // Only reachable when the study allows sessions without recording.
    set({ phase: 'task_intro', recordingEnabled: false });
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
        // events and answers are still full evidence.
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
      track('question_answered', { taskId: a.taskId, meta: { questionId: a.questionId } });
    }
    const all = [...answers, ...newAnswers];
    set({ answers: all });
    if (newAnswers.length > 0) {
      try {
        await api.sendAnswers(sessionId, newAnswers);
      } catch {
        // Answers also ride the event stream metadata; retry happens at drain.
      }
    }

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
        set({ pendingSegments: get().pendingSegments.slice(1) });
        track('recording_uploaded', { meta: { segment: seg.segment } });
      }
      setUploadState('uploaded');

      track('session_completed');
      await drain();
      await api.completeSession(sessionId);
      await clearQueue();
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
    set({
      phase: 'idle',
      error: undefined,
      bootstrap: undefined,
      sessionId: undefined,
      currentTaskIndex: 0,
      pendingQuestions: [],
      answers: [],
      participantProfile: undefined,
      recordingEnabled: false,
      taskBusy: false,
      uploadProgress: undefined,
      pendingSegments: [],
      interruptedFrom: undefined,
    });
  },
}));
