/**
 * Shared contracts between the mobile runtime and the backend API.
 * Mirror of the "Data Bridge" section of the product documentation:
 * the mobile app only consumes a published StudyVersion payload and
 * returns raw evidence (recording, taps, answers, device context).
 */

export type Platform = 'ios' | 'android';

export interface PrototypeConfig {
  /**
   * figma_proto (and other canvas-rendered viewers) get screen identity
   * from native frame captures clustered server-side, since the viewer
   * exposes no DOM/URL signal for the current frame.
   */
  type: 'html_package' | 'live_url' | 'figma_proto';
  platform: 'mobile_app';
  entryUrl: string;
  viewport: { width: number; height: number };
}

export interface TaskConfig {
  id: string;
  title: string;
  instruction: string;
  /** Optional URL the player should navigate to when the task starts. */
  startUrl?: string;
  required: boolean;
  /**
   * Screen id(s) that mark this task as successfully completed. When the
   * prototype reaches any of them the task auto-completes (Maze-style) —
   * the participant never taps "I completed the task". Ids are matched
   * against the same screen signal used for analytics (WebView bridge hash
   * for DOM/hosted prototypes; server-clustered frame `screenKey`). Omit
   * for open-ended tasks (e.g. "explore the app"), which keep the manual
   * Done? action.
   */
  successScreenIds?: string[];
}

export type QuestionType =
  | 'open_text'
  /** Synth's name for open_text — accepted as an alias so the web builder
   *  can send its native type names unmapped. */
  | 'open_question'
  | 'opinion_scale'
  | 'multiple_choice'
  | 'yes_no'
  /** Informational block (markdown body, no answer). */
  | 'context_screen'
  /** Single-line input with a keyboard hint (text/email/phone/number). */
  | 'simple_input';

export interface QuestionBlock {
  id: string;
  /** If set, the question is shown right after this task. Otherwise post-test. */
  afterTaskId?: string;
  type: QuestionType;
  title: string;
  description?: string;
  required: boolean;
  /** opinion_scale */
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  /** opinion_scale — 'emoji' renders faces when the scale has exactly 5 steps. */
  scaleStyle?: 'numeric' | 'emoji';
  /** multiple_choice */
  options?: string[];
  multiSelect?: boolean;
  /** multiple_choice — offer a free-text "Other" answer. */
  allowOther?: boolean;
  /** context_screen */
  bodyMarkdown?: string;
  /** simple_input */
  inputType?: 'text' | 'email' | 'phone' | 'number';
  /** open_text / open_question / simple_input */
  placeholder?: string;
}

export interface ConsentConfig {
  version: string;
  body: string;
}

/**
 * Guest participant intake. Testers are not authenticated — they are
 * anonymous guests who describe themselves before the test so the web
 * dashboard can build user personas from the results. The set of fields
 * (and whether the study asks for them) is configurable per study; the
 * app renders whatever the bootstrap declares.
 */
export interface IntakeConfig {
  /** If false, the study skips the intake screen entirely. */
  enabled: boolean;
  askFullName: boolean;
  askAge: boolean;
  askRole: boolean;
  /** Predefined roles the tester picks from; free text is also allowed. */
  roleOptions: string[];
}

export interface ParticipantProfile {
  /** Stable guest id, generated on device (no login). */
  participantId: string;
  fullName?: string;
  age?: number;
  role?: string;
}

export interface BootstrapPayload {
  sessionId: string;
  studyVersionId: string;
  studyName: string;
  expiresAt: string;
  recordingRequired: boolean;
  prototype: PrototypeConfig;
  consent: ConsentConfig;
  intake: IntakeConfig;
  tasks: TaskConfig[];
  questionBlocks: QuestionBlock[];
}

export interface StartSessionResponse {
  sessionId: string;
  sessionToken: string;
}

/* ---------------------------- Events ---------------------------- */

export type SessionEventType =
  | 'session_started'
  | 'consent_accepted'
  | 'participant_profile_submitted'
  | 'recording_started'
  | 'recording_stopped'
  | 'task_started'
  /** Prototype reached the task's declared goal screen — the app auto-completes. */
  | 'task_goal_reached'
  | 'task_completed'
  | 'task_abandoned'
  | 'tap'
  | 'prototype_navigation'
  | 'question_answered'
  | 'app_backgrounded'
  | 'app_foregrounded'
  | 'test_interrupted'
  | 'test_resumed'
  | 'recording_uploaded'
  /** Participant continued without recording after denial/unavailability. */
  | 'recording_skipped'
  /** A finished segment was lost (stop failure or missing file). */
  | 'recording_discarded'
  | 'session_completed';

export interface SessionEvent {
  eventId: string;
  sessionId: string;
  type: SessionEventType;
  /** ms since session start (monotonic clock). */
  timestampMs: number;
  /** ms since recording start; -1 when not recording. */
  recordingTimeMs: number;
  /**
   * Which recording segment recordingTimeMs is relative to. A session can
   * have several segments: recording stops when the participant leaves the
   * app mid-test and a new segment starts when they resume.
   */
  recordingSegment?: number;
  taskId?: string;
  /** Tap payload */
  x?: number;
  y?: number;
  normalizedX?: number;
  normalizedY?: number;
  screenWidth?: number;
  screenHeight?: number;
  pixelRatio?: number;
  orientation?: 'portrait' | 'landscape';
  /** Freeform metadata (navigation URL, abandon reason, ...). */
  meta?: Record<string, string | number | boolean>;
  appVersion: string;
}

export interface AnswerPayload {
  questionId: string;
  taskId?: string;
  type: QuestionType;
  value: string | number | string[] | boolean;
  answeredAtMs: number;
}

export interface DeviceContext {
  platform: Platform;
  osVersion: string;
  model: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  appVersion: string;
  locale: string;
}

/* --------------------------- Recording -------------------------- */

export type RecordingState =
  | 'idle'
  | 'preparing'
  | 'permission_required'
  | 'recording'
  | 'stopping'
  | 'encoding'
  | 'upload_pending'
  | 'uploading'
  | 'uploaded'
  | 'failed_retryable'
  | 'failed_final';

export interface RecordingCompletePayload {
  recordingId: string;
  storageKey: string;
  durationMs: number;
  /** 0-based segment index (a session can have several segments). */
  segment: number;
  checksum: string;
  fileSizeBytes: number;
  width: number;
  height: number;
}
