import * as SecureStore from '../native/secureStore';
import { randomUUID } from '../utils/crypto';
import {
  ensureAuth,
  getSynthApiBase,
  hasAuthSession,
  redeemInvite,
  setSynthApiBase,
  synth,
  updateTesterProfile,
} from '../lib/synthClient';
import {
  AnswerPayload,
  BootstrapPayload,
  DeviceContext,
  GraphConfig,
  ParticipantProfile,
  PrototypeConfig,
  QuestionBlock,
  QuestionType,
  RecordingCompletePayload,
  SessionEvent,
  StartSessionResponse,
  TaskConfig,
} from '../types';
import type { TaskGoal } from '../lib/goalMatch';
import { shouldExcludeTapFromHeatmap } from '../lib/studyChrome';

/**
 * Session Client — the only door to the backend. Talks directly to the
 * synth (TawakkalnaOS web app) Supabase project + its /api/mobile/* and
 * /api/human-beats routes. Function signatures here are unchanged from the
 * original custom-dev-server client so sessionStore.ts and every screen work
 * without modification — only the implementation moved.
 *
 * Must stay in sync with synth's packages/types HUMAN_CONSENT_VERSION.
 */
const HUMAN_CONSENT_VERSION = 'v1';

let currentStudyId: string | null = null;

export function setApiBase(url: string) {
  setSynthApiBase(url);
}

export function getApiBase() {
  return getSynthApiBase();
}

const SNAPSHOT_KEY = 'twk_session_token';

export async function persistToken(sessionId: string, studyId: string) {
  currentStudyId = studyId;
  await SecureStore.setItem(SNAPSHOT_KEY, JSON.stringify({ sessionId, studyId }));
}

export async function restoreToken(sessionId: string): Promise<boolean> {
  const raw = await SecureStore.getItem(SNAPSHOT_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { sessionId: string; studyId: string };
    if (parsed.sessionId !== sessionId) return false;
    if (!(await hasAuthSession())) return false;
    currentStudyId = parsed.studyId;
    return true;
  } catch {
    return false;
  }
}

/**
 * Stable anonymous guest id for this device, kept only as a local display
 * fallback — synth identifies testers by their real Supabase auth.uid(),
 * not this value.
 */
export async function getGuestParticipantId(): Promise<string> {
  const existing = await SecureStore.getItem('twk_guest_id');
  if (existing) return existing;
  const id = `guest_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await SecureStore.setItem('twk_guest_id', id);
  return id;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/* ---------------------- synth study-content shapes ---------------------- */

interface SynthPrototype {
  id: string;
  label: string;
  prototype_url: string;
  device: 'mobile' | 'desktop';
  is_figma_embed: boolean;
}
interface SynthPrompt {
  id: string;
  type: string;
  title: string;
  description: string | null;
  prototype_id: string | null;
  expected_success_screen: string | null;
  config: unknown;
}
interface SynthGraphScreen {
  nodeId: string;
  image_url: string | null;
  name: string;
  width: number;
  height: number;
  is_start: boolean;
}
interface SynthGraphHotspot {
  screenNodeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  destinationNodeId: string | null;
  navKind: string;
  dangling: boolean;
}
interface SynthStudyContent {
  study: {
    id: string;
    title: string;
    ai_observation_enabled: boolean;
    prototype_source: 'url' | 'figma';
  };
  prototypes: SynthPrototype[];
  prompts: SynthPrompt[];
  graph: {
    ready: boolean;
    start_node_id: string | null;
    screens: SynthGraphScreen[];
    hotspots: SynthGraphHotspot[];
  };
  figma_frames: { id: string; image_url: string; name: string; width: number; height: number; is_start_frame: boolean }[];
}

function consentBody(aiObservationEnabled: boolean): string {
  const lines = [
    'What we collect:',
    '- Whether you completed each task, and how long it took.',
    '- Your ease rating and any notes you choose to write.',
    '- Taps and screens visited, so the researcher can see where people get stuck.',
    '- A recording of this app only, while you are doing the tasks.',
  ];
  if (aiObservationEnabled) {
    lines.push(
      '',
      'This session will be observed by AI to help identify usability patterns. This is required to take part in this study.',
    );
  }
  return lines.join('\n');
}

function translateQuestionPrompt(p: SynthPrompt, afterTaskId: string | undefined): QuestionBlock {
  const cfg = (p.config ?? {}) as Record<string, unknown>;
  const base = {
    id: p.id,
    afterTaskId,
    title: p.title,
    description: p.description ?? undefined,
    required: true,
  };
  switch (p.type) {
    case 'opinion_scale':
      return {
        ...base,
        type: 'opinion_scale',
        scaleMin: typeof cfg.min === 'number' ? cfg.min : 1,
        scaleMax: typeof cfg.max === 'number' ? cfg.max : 5,
        scaleMinLabel: (cfg.min_label as string) || undefined,
        scaleMaxLabel: (cfg.max_label as string) || undefined,
        scaleStyle: cfg.style === 'emoji' ? 'emoji' : 'numeric',
      };
    case 'multiple_choice': {
      const options = Array.isArray(cfg.options)
        ? (cfg.options as { label?: string }[]).map((o) => o.label ?? '').filter(Boolean)
        : [];
      return {
        ...base,
        type: 'multiple_choice',
        options,
        multiSelect: !!cfg.multi_select,
        allowOther: !!cfg.allow_other,
      };
    }
    case 'context_screen':
      return { ...base, type: 'context_screen', bodyMarkdown: (cfg.body_markdown as string) || '' };
    case 'simple_input': {
      const inputType = cfg.input_type;
      return {
        ...base,
        type: 'simple_input',
        inputType: (['text', 'email', 'phone', 'number'] as const).includes(inputType as never)
          ? (inputType as 'text' | 'email' | 'phone' | 'number')
          : 'text',
        placeholder: (cfg.placeholder as string) || undefined,
      };
    }
    case 'open_question':
    default:
      return { ...base, type: 'open_question' as QuestionType };
  }
}

/**
 * Is this an UPLOADED HTML prototype (synth serves it from /p/<prototype_id>)?
 *
 * It matters for two reasons: that route is the only prototype synth can inject
 * the tracker into (so it is the only one that can auto-complete a task), and the
 * injection is opt-in via query params — see instrumentPrototypeUrl.
 */
function isUploadedHtmlUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/p/');
  } catch {
    return false;
  }
}

/**
 * Turns an uploaded-HTML prototype URL into an INSTRUMENTED one.
 *
 * `?h=<sessionId>` is what makes synth's /p route inject its tracker at all —
 * without it the WebView loads plain HTML and the app sees no clicks, no screen
 * changes and no completion signal (which is exactly why HTML tasks used to be
 * manual-only on mobile). `host=native` then tells that tracker to skip its own
 * /api/human-beats and /api/human-base posts: this app already ships those
 * events through its authenticated queue (posting twice would double the
 * heatmap), and a WebView carries no auth cookie so they would 401 anyway.
 */
function instrumentPrototypeUrl(url: string, sessionId: string): string {
  if (!isUploadedHtmlUrl(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}h=${encodeURIComponent(sessionId)}&host=native`;
}

/** The Mission's completion goal, when the study author set one. */
function translateGoal(config: unknown): TaskGoal | undefined {
  const goal = (config as { goal?: TaskGoal } | null)?.goal;
  // `v: 1` is the drift guard against synth's packages/types/src/goal.ts — an
  // unknown version means "don't auto-complete", never "guess".
  if (!goal || goal.v !== 1 || !Array.isArray(goal.any) || goal.any.length === 0) return undefined;
  return goal;
}

function translateBootstrap(sessionId: string, raw: SynthStudyContent): BootstrapPayload {
  const protoById = new Map(raw.prototypes.map((p) => [p.id, p]));
  const defaultProto = raw.prototypes[0];

  let prototype: PrototypeConfig;
  if (raw.graph.ready) {
    const graph: GraphConfig = {
      startNodeId: raw.graph.start_node_id ?? raw.graph.screens.find((s) => s.is_start)?.nodeId ?? '',
      screens: raw.graph.screens.map((s) => ({
        nodeId: s.nodeId,
        imageUrl: s.image_url,
        name: s.name,
        width: s.width,
        height: s.height,
        isStart: s.is_start,
      })),
      hotspots: raw.graph.hotspots.map((h) => ({
        screenNodeId: h.screenNodeId,
        x: h.x,
        y: h.y,
        w: h.w,
        h: h.h,
        destinationNodeId: h.destinationNodeId,
        dangling: h.dangling,
      })),
    };
    prototype = {
      type: 'figma_graph',
      platform: 'mobile_app',
      entryUrl: '',
      viewport: { width: 390, height: 844 },
      graph,
    };
  } else if (defaultProto) {
    prototype = {
      type: defaultProto.is_figma_embed
        ? 'figma_proto'
        : isUploadedHtmlUrl(defaultProto.prototype_url)
          ? 'html_package'
          : 'live_url',
      platform: 'mobile_app',
      entryUrl: instrumentPrototypeUrl(defaultProto.prototype_url, sessionId),
      viewport: { width: 390, height: 844 },
    };
  } else {
    // No confirmed graph and no URL prototype (Figma frames only, not yet
    // confirmed clickable) — nothing this runtime can render. Surfaced as
    // "study has no tasks" by the caller's tasks.length check below only if
    // there are also no missions; otherwise this is a known v1 gap (see
    // AGENTS/summary — ungraphed Figma-frame-only studies aren't supported).
    prototype = { type: 'live_url', platform: 'mobile_app', entryUrl: '', viewport: { width: 390, height: 844 } };
  }

  const tasks: TaskConfig[] = [];
  const questionBlocks: QuestionBlock[] = [];
  let lastMissionId: string | undefined;
  for (const p of raw.prompts) {
    if (p.type === 'mission') {
      const proto = p.prototype_id ? protoById.get(p.prototype_id) : undefined;
      tasks.push({
        id: p.id,
        title: p.title,
        instruction: p.description ?? '',
        startUrl:
          proto && !raw.graph.ready
            ? instrumentPrototypeUrl(proto.prototype_url, sessionId)
            : undefined,
        required: true,
        successScreenIds: p.expected_success_screen ? [p.expected_success_screen] : undefined,
        goal: translateGoal(p.config),
      });
      lastMissionId = p.id;
    } else {
      questionBlocks.push(translateQuestionPrompt(p, lastMissionId));
    }
  }

  return {
    sessionId,
    studyVersionId: raw.study.id,
    studyName: raw.study.title,
    // synth has no per-invite expiry (only active/inactive + closed_at,
    // both checked server-side at redeem/begin time) — far-future sentinel.
    expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    recordingRequired: true,
    prototype,
    consent: { version: HUMAN_CONSENT_VERSION, body: consentBody(raw.study.ai_observation_enabled) },
    intake: { enabled: true, askFullName: true, askAge: true, askRole: true, roleOptions: [] },
    tasks,
    questionBlocks,
  };
}

/* ------------------------- Endpoint map ------------------------- */

export async function startSession(testToken: string, _device: DeviceContext): Promise<StartSessionResponse> {
  let studyId: string;
  try {
    studyId = await redeemInvite(testToken);
  } catch (err) {
    // Mirrors the old server's 410 for an expired/invalid link — sessionStore
    // shows "This test link has expired." for this status.
    throw new ApiError(410, 'expired', err instanceof Error ? err.message : 'Invalid or inactive invite code');
  }
  const { session_id } = await synth.post<{ session_id: string }>('/mobile/session/begin', {
    study_id: studyId,
  });
  currentStudyId = studyId;
  // sessionToken is repurposed to carry studyId through persistToken/restoreToken.
  return { sessionId: session_id, sessionToken: studyId };
}

export async function fetchBootstrap(sessionId: string): Promise<BootstrapPayload> {
  if (!currentStudyId) throw new ApiError(404, 'no_study', 'No active study for this session.');
  const raw = await synth.get<SynthStudyContent>(
    `/mobile/study-content?study_id=${encodeURIComponent(currentStudyId)}`,
  );
  return translateBootstrap(sessionId, raw);
}

export async function acceptConsent(sessionId: string, _consentVersion: string, _deviceId: string) {
  await synth.post('/mobile/session/consent', { session_id: sessionId });
  return { ok: true as const };
}

/** Guest profile for personas — writes tester_name/age/role directly (RLS: own row only). */
export async function submitParticipantProfile(
  sessionId: string,
  profile: Omit<ParticipantProfile, 'participantId'>,
) {
  const participantId = await getGuestParticipantId();
  await updateTesterProfile(sessionId, profile);
  return { ok: true as const, participantId };
}

/** synth has no server-side "reserve a recording slot" — the caller discards the result anyway. */
export async function startRecordingSlot(_sessionId: string) {
  return { recordingId: '' };
}

/**
 * Fans the batch out to synth's /api/human-beats (taps + screen navigation —
 * the heatmap signal). Lifecycle-only events (session_started, app_backgrounded,
 * recording_*, ...) have no home in synth's schema yet and are acknowledged
 * without a write — they still ride the mobile-side event log for local
 * debugging, just not persisted server-side.
 */
export async function sendEventBatch(sessionId: string, idempotencyKey: string, events: SessionEvent[]) {
  const beats = events
    .map((e) => toBeat(e))
    .filter((b): b is NonNullable<ReturnType<typeof toBeat>> => b != null);
  if (beats.length > 0) {
    // The idempotency key used to be computed by eventQueue and then dropped
    // on the floor here (it was named `_idempotencyKey` and never sent), while
    // /api/human-beats does a plain insert. So a batch whose POST reached the
    // server but whose *response* was lost — the classic 5G↔Wi-Fi handoff —
    // came back on the next flush and duplicated every click and navigation in
    // it, inflating the heatmap, the path counts and the dwell times.
    //
    // Both keys are now transmitted: `idempotency_key` for the batch, and `bid`
    // per beat (the stable event id, see toBeat) so the server can dedup at
    // whichever granularity it implements. Until synth dedups, these are inert
    // extra fields — the route ignores unknown keys — so this is the half of
    // the fix that lives in this repo, not the whole fix.
    await synth.post('/human-beats', { session_id: sessionId, beats, idempotency_key: idempotencyKey });
  }
  return { accepted: events.length };
}

function toBeat(e: SessionEvent): Record<string, unknown> | null {
  // `mi` (mission index) lets synth segment beats into per-mission runs — the
  // mobile session clock is monotonic across missions (never resets like the
  // web embed remount), so the server's t_ms-drop heuristic can't split them.
  const mi = typeof e.meta?.missionIndex === 'number' ? e.meta.missionIndex : undefined;
  if (e.type === 'tap') {
    if (shouldExcludeTapFromHeatmap(e)) return null;
    const rawScreen = typeof e.meta?.prototypeScreenId === 'string' ? e.meta.prototypeScreenId : '';
    // 'entry' is the placeholder id before the bridge reports the first real
    // prototype screen — don't tag clicks with it (keeps it out of analytics).
    const screen = rawScreen === 'entry' ? '' : rawScreen;
    return {
      kind: 'click',
      x: e.normalizedX != null ? Math.round(e.normalizedX * (e.screenWidth ?? 390)) : 0,
      y: e.normalizedY != null ? Math.round(e.normalizedY * (e.screenHeight ?? 844)) : 0,
      vw: e.screenWidth ?? 390,
      vh: e.screenHeight ?? 844,
      path: screen,
      // `screen` -> screen_node_id: the graph-model Analyze surfaces (mission
      // screens, paths, heatmap modal, misclick) key clicks by node id.
      screen,
      label: '',
      t: e.timestampMs,
      // Stable per-beat id (evt_<sessionId>_<seq>) so a re-sent batch is
      // recognizable as the same beats rather than new ones.
      bid: e.eventId,
      ...(mi != null ? { mi } : {}),
    };
  }
  if (e.type === 'prototype_navigation') {
    const screenId = e.meta?.prototypeScreenId;
    // URL-only navigations (no prototype screen id) carry no node — skip.
    if (typeof screenId !== 'string') return null;
    return {
      kind: 'navigate',
      path: screenId,
      // screen + screen_enter drive the Analyze path reconstruction, screen
      // grid, funnel and navigation diagram (all read graph_event/screen_node_id).
      screen: screenId,
      event: 'screen_enter',
      t: e.timestampMs,
      bid: e.eventId,
      ...(mi != null ? { mi } : {}),
    };
  }
  return null;
}

/**
 * Delivers each answer/mission-outcome as a synth session_prompt_outcome.
 * Called only from the durable, retried answersOutbox — never directly —
 * so an offline stretch during the questions never loses a value (same
 * guarantee the old batch endpoint gave; upsert-by-prompt-id here too, so a
 * retry after a partial failure never duplicates).
 */
export async function sendAnswers(sessionId: string, answers: AnswerPayload[]) {
  await Promise.all(
    answers.map(async (a) => {
      let missionOutcome: { __kind?: string; outcome?: string; durationMs?: number } | null = null;
      if (typeof a.value === 'string') {
        try {
          const parsed = JSON.parse(a.value);
          if (parsed && parsed.__kind === 'mission_outcome') missionOutcome = parsed;
        } catch {
          /* not a mission-outcome sentinel — a normal string answer */
        }
      }
      if (missionOutcome) {
        await synth.post('/mobile/session/prompt-outcome', {
          session_id: sessionId,
          prompt_id: a.questionId,
          outcome: missionOutcome.outcome === 'completed' ? 'completed' : 'bounced',
          duration_ms: missionOutcome.durationMs ?? 0,
        });
        return;
      }
      const isOpenText = a.type === 'open_text' || a.type === 'open_question' || a.type === 'simple_input';
      await synth.post('/mobile/session/prompt-outcome', {
        session_id: sessionId,
        prompt_id: a.questionId,
        outcome: 'completed',
        duration_ms: 0,
        ...(isOpenText ? { free_text_response: String(a.value) } : {}),
        response_data: a.value,
      });
    }),
  );
  return { ok: true as const };
}

export async function getUploadUrl(sessionId: string, recordingId: string, _fileSizeBytes: number) {
  const { upload_url, storage_path } = await synth.post<{ upload_url: string; storage_path: string }>(
    '/mobile/recordings/start',
    { session_id: sessionId, recording_id: recordingId },
  );
  return { uploadUrl: upload_url, storageKey: storage_path };
}

export async function completeRecording(
  sessionId: string,
  payload: RecordingCompletePayload,
  timeoutMs?: number,
) {
  await synth.post(
    '/mobile/recordings/complete',
    {
      session_id: sessionId,
      recording_id: payload.recordingId,
      storage_path: payload.storageKey,
      segment: payload.segment,
      duration_ms: payload.durationMs,
      checksum: payload.checksum,
      file_size_bytes: payload.fileSizeBytes,
      width: payload.width,
      height: payload.height,
    },
    timeoutMs,
  );
  return { ok: true as const };
}

/**
 * Closes the session row.
 *
 * Call this EXACTLY ONCE per session: `finalizeHumanSession` recomputes
 * `real_duration_ms` as `now - started_at`, so a second call after a slow
 * video upload would silently inflate the participant's measured
 * time-on-task. Late diagnostics go through `writeSessionDiagnostics`
 * instead (see sessionStore.resultsSubmitted).
 */
export async function completeSession(sessionId: string, notes?: string) {
  // ease_rating is required by synth's finalize contract; the post-test
  // "how was it" question (opinion_scale, scale 1-5) already collects this
  // as a normal answer via submitAnswers/sendAnswers above — finalize just
  // needs SOME value, so default to a neutral 3 when the study has no such
  // question (finalize is about closing the session row, not re-scoring it).
  await synth.post('/mobile/session/finalize', {
    session_id: sessionId,
    completion: true,
    ease_rating: 3,
    ...(notes ? { notes: notes.slice(0, 2000) } : {}),
  });
  return { ok: true as const };
}

/**
 * Frame capture. Screen IDENTITY comes from the WebView bridge's node-id/hash
 * (unlike the old dev server there is no server-side pHash clustering), so
 * screenKey is always null — but the frame itself becomes the study's heatmap
 * BASE image: synth's Spatial Analytics needs a screenshot of each screen to
 * draw click points on, and for Figma/external prototypes only the native app
 * can produce one (the web tester iframe can't screenshot cross-origin).
 * First frame per (study, viewport, screen) wins server-side.
 */
export async function uploadFrame(
  sessionId: string,
  imageBase64: string,
  _atMs: number,
  screenPath?: string,
  width?: number,
  height?: number,
) {
  if (screenPath && width && height) {
    await synth.post('/mobile/frames', {
      session_id: sessionId,
      screen_path: screenPath,
      image_base64: imageBase64,
      width,
      height,
    });
  }
  return { screenKey: null, isNew: false, blank: false };
}

export { ensureAuth };
