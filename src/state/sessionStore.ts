import { Dimensions, PixelRatio, Platform } from 'react-native';
import { APP_VERSION as BUILD_VERSION, DEVICE_MODEL, LAUNCH_ID } from '../constants';
import { create } from 'zustand';
import * as api from '../api/client';
import { clearQueue, drain, initQueue, track } from '../events/eventQueue';
import {
  discardSessionRecording,
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
 *
 * Testers are guests (no login). Intake collects name / age / role for
 * user personas before recording or tasks begin.
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
  uploadProgress?: UploadProgress;
  finishedRecording?: { fileUri: string; durationMs: number };

  resolveFromToken: (testToken: string, apiOverride?: string) => Promise<void>;
  acceptConsent: () => Promise<void>;
  submitIntake: (fields: Omit<ParticipantProfile, 'participantId'>) => Promise<void>;
  grantRecording: () => Promise<void>;
  skipRecordingUnavailable: () => void;
  beginTask: () => void;
  completeTask: (outcome: 'completed' | 'abandoned') => void;
  submitAnswers: (answers: AnswerPayload[]) => Promise<void>;
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
  participantProfile: undefined,

  resolveFromToken: async (testToken, apiOverride) => {
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
      set({ phase: 'consent', bootstrap, sessionId, currentTaskIndex: 0, answers: [] });
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

  grantRecording: async () => {
    const { sessionId } = get();
    if (!sessionId) return;
    const available = await recorderAvailable();
    if (!available) {
      // Simulator / Expo Go: recording layer unavailable.
      set({ phase: 'permission_denied', error: 'recording_unavailable' });
      return;
    }
    try {
      await api.startRecordingSlot(sessionId);
      await startSessionRecording();
      set({ phase: 'task_intro', recordingEnabled: true });
    } catch {
      set({ phase: 'permission_denied', error: 'permission_denied' });
    }
  },

  skipRecordingUnavailable: () => {
    // Only reachable when the study allows sessions without recording.
    set({ phase: 'task_intro', recordingEnabled: false });
  },

  beginTask: () => {
    const { bootstrap, currentTaskIndex } = get();
    const task = bootstrap?.tasks[currentTaskIndex];
    if (!task) return;
    track('task_started', { taskId: task.id });
    set({ phase: 'testing' });
  },

  completeTask: (outcome) => {
    const { bootstrap, currentTaskIndex } = get();
    if (!bootstrap) return;
    const task = bootstrap.tasks[currentTaskIndex];
    track(outcome === 'completed' ? 'task_completed' : 'task_abandoned', { taskId: task.id });

    const taskQuestions = questionsForTask(bootstrap, task.id);
    if (taskQuestions.length > 0) {
      set({ phase: 'task_questions', pendingQuestions: taskQuestions });
    } else {
      get().submitAnswers([]);
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

  finishSession: async () => {
    const { sessionId, recordingEnabled, bootstrap } = get();
    if (!sessionId || !bootstrap) return;
    set({ phase: 'uploading', uploadProgress: undefined });

    try {
      let finished = get().finishedRecording;
      if (recordingEnabled && !finished) {
        // Stopping the native recorder must not hang the session forever;
        // if it stalls or fails, we surface it as a retryable upload state
        // rather than leaving the participant on a spinner.
        finished = await withTimeout(
          stopSessionRecording(),
          20000,
          'Recording did not stop in time.',
        );
        set({ finishedRecording: finished });
      }
      if (finished) {
        setUploadState('uploading');
        const { width, height } = Dimensions.get('screen');
        await uploadRecording({
          sessionId,
          recordingId: `rec_${sessionId}`,
          fileUri: finished.fileUri,
          durationMs: finished.durationMs,
          width: Math.round(width * PixelRatio.get()),
          height: Math.round(height * PixelRatio.get()),
          onProgress: (p) => set({ uploadProgress: p }),
        });
        setUploadState('uploaded');
        track('recording_uploaded');
      }

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
      uploadProgress: undefined,
      finishedRecording: undefined,
    });
  },
}));
