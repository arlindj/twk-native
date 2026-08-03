import { useKeepAwake } from '../native/keepAwake';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';
import { uploadFrame } from '../api/client';
import { TapOverlay } from '../components/TapOverlay';
import { Button } from '../components/ui';
import { FloatingTaskControl } from '../components/FloatingTaskControl';
import { TaskSheet } from '../components/TaskSheet';
import { GoalReachedModal } from '../components/GoalReachedModal';
import { sessionElapsedMs, track } from '../events/eventQueue';
import {
  matchesGoal,
  parseGoalSignal,
  screenIdFromKey,
  screenKeyEquals,
  type GoalSignal,
  type ScreenKey,
} from '../lib/goalMatch';
import { shouldExcludeTapFromHeatmap } from '../lib/studyChrome';
import { useSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';

/**
 * Injected into the prototype WebView. Reports which prototype screen is
 * active, viewport-normalized coordinates for every tap, and — for prototypes
 * synth cannot instrument itself — the same `synth-signal` completion shape the
 * injected tracker emits, so ONE matcher (src/lib/goalMatch.ts) decides
 * completion for Figma, live URLs and uploaded HTML alike.
 *
 * Screen identity comes from two sources, in priority order:
 *  1. `node-id` in the URL query — Figma's proto viewer rewrites the URL
 *     (history.replaceState, no navigation event) every time the user
 *     moves between frames, so a poller watches location.href for changes.
 *  2. `location.hash` — used by prototypes we host ourselves.
 *
 * Verified constraints from testing against a live Figma proto link:
 *  1. Uses `touchstart`, not `click`: prototyping tools call
 *     preventDefault() on touch to stop native scroll/zoom, which
 *     suppresses the synthetic `click` WebKit would otherwise fire.
 *     touchstart always fires and runs before preventDefault can apply.
 *  2. Figma renders the whole UI on one <canvas> — no DOM buttons exist,
 *     so DOM-based misclick detection is impossible there. `interactive`
 *     stays meaningful only for DOM-based prototypes; for Figma the
 *     dashboard derives an "effective tap" signal behaviorally (tap
 *     followed by a screen change).
 *  3. Figma performs internal redirects after the initial load, and
 *     injectedJavaScript runs only on the first load — so the bridge is
 *     re-injected on every onLoadEnd, guarded against duplicates.
 *
 * `window.__synthTracker` is set by synth's own injected tracker (uploaded HTML
 * loaded with ?h=&host=native). When it is present the bridge keeps reporting
 * taps/screens for analytics but stays SILENT on completion — the tracker's
 * signal is richer (authored screen names, full element fingerprints) and two
 * sources could disagree on the same tap.
 */
const PROTOTYPE_BRIDGE_JS = `
(function () {
  if (window.__twkBridgeInstalled) return true;
  window.__twkBridgeInstalled = true;
  function screenId() {
    var m = location.href.match(/[?&]node-id=([^&#]+)/);
    if (m) return decodeURIComponent(m[1]);
    return (location.hash || '#entry').replace('#', '');
  }
  function post(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  function owned() { return !window.__synthTracker; }
  function norm(t) {
    if (!t) return '';
    return String(t).replace(/\\s+/g, ' ').replace(/^ | $/g, '').toLowerCase().slice(0, 80);
  }
  // ScreenKey for the goal matcher. The viewer's node-id / hash IS the authored
  // screen name here, which is the matcher's highest-priority field — there is
  // no DOM signature to compute for a canvas prototype.
  function skey() {
    return { path: location.pathname, hash: location.hash, sig: '', name: screenId() };
  }
  // Compact ElementFingerprint — the same selector priority the web tracker
  // uses, minus the structural fallback (this bridge also runs on pages whose
  // DOM we do not control, where a positional path is worthless).
  function fp(raw) {
    var sel = [], text = '', role = '', aria = '', goal = '';
    // Selectors from the tapped element ONLY — an ancestor id would be the
    // screen container's, and matching on it would fire for every tap on that
    // screen.
    try {
      var tag0 = raw.tagName.toLowerCase();
      var g0 = raw.getAttribute('data-synth-goal');
      if (g0) { goal = String(g0).slice(0, 120); sel.push('[data-synth-goal="' + g0 + '"]'); }
      var tid = raw.getAttribute('data-testid');
      if (tid) sel.push('[data-testid="' + tid + '"]');
      if (raw.id) sel.push('#' + raw.id);
      var nm = raw.getAttribute('name');
      if (nm) sel.push(tag0 + '[name="' + nm + '"]');
      var al0 = raw.getAttribute('aria-label');
      if (al0) { sel.push(tag0 + '[aria-label="' + al0 + '"]'); aria = al0; }
    } catch (_) {}
    // Text / role / aria walk up — a label often lives on a wrapper.
    var el = raw, d = 0;
    while (el && el.nodeType === 1 && d < 5) {
      try {
        var tag = el.tagName.toLowerCase();
        if (!goal) { var g = el.getAttribute('data-synth-goal'); if (g) goal = String(g).slice(0, 120); }
        if (!aria) { var al = el.getAttribute('aria-label'); if (al) aria = al; }
        if (!role) role = (el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : '')).toLowerCase();
        if (!text) { var tx = el.innerText || el.textContent || ''; if (tx && tx.length <= 160) text = tx; }
      } catch (_) {}
      el = el.parentElement; d++;
    }
    var out = { sel: sel.slice(0, 8), text: norm(text) };
    if (role) out.role = role;
    if (aria) out.aria = norm(aria);
    if (goal) out.goal = goal;
    return out;
  }
  function signal(kind, el) {
    if (!owned()) return;
    var p = { type: 'synth-signal', v: 1, kind: kind, screen: skey(), ts: Date.now() };
    if (el) p.el = el;
    post(p);
  }
  // Screen NAVIGATION is reported only when we own the page. On an instrumented
  // prototype the tracker's screen signal is authoritative (it can see authored
  // names and DOM-only swaps this bridge can't), and reporting both would give
  // analytics two different ids for the same screen.
  function postScreen() {
    if (!owned()) return;
    post({ kind: 'screen', screenId: screenId() });
  }
  document.addEventListener('touchstart', function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    var el = t.target && t.target.closest
      ? t.target.closest('a,button,input,select,textarea,[onclick],[role="button"],[data-synth-goal]')
      : null;
    post({
      kind: 'tap',
      // Same reason as postScreen: on an instrumented page the tracker owns
      // screen identity, so the tap is left unlabelled and the native side tags
      // it with the screen the tracker last reported.
      screenId: owned() ? screenId() : undefined,
      nx: Math.max(0, Math.min(1, t.clientX / window.innerWidth)),
      ny: Math.max(0, Math.min(1, t.clientY / window.innerHeight)),
      interactive: !!el,
    });
    if (t.target && t.target.nodeType === 1) signal('element', fp(el || t.target));
  }, true);
  // A prototype can also end the task itself (the declared convention).
  window.addEventListener('message', function (e) {
    try {
      var d = e.data;
      if (!d || d.type !== 'synth-task-complete') return;
      if (!owned()) return;
      var p = { type: 'synth-signal', v: 1, kind: 'declared', screen: skey(), ts: Date.now() };
      if (typeof d.name === 'string') p.name = String(d.name).slice(0, 120);
      post(p);
    } catch (_) {}
  });
  postScreen();
  signal('screen');
  window.addEventListener('hashchange', function () {
    postScreen();
    signal('screen');
  });
  // Some viewers update the URL via history.replaceState (no event) — poll.
  var lastScreen = screenId();
  setInterval(function () {
    var s = screenId();
    if (s !== lastScreen) {
      lastScreen = s;
      postScreen();
      signal('screen');
    }
  }, 400);
})();
true;
`;

/**
 * Prototype Player — full-screen WebView (MVP path from the docs)
 * wrapped in the TapOverlay so every tap is captured natively even
 * when the embedded prototype doesn't cooperate. A minimal floating
 * bar (Maze-style) exposes the task and the complete/give-up actions
 * without polluting the recording with dashboard UI.
 *
 * Two tap streams feed the evidence pipeline:
 *  - native overlay taps (device-screen coords, recording-clock synced)
 *    → used by the web replay to place markers over the video;
 *  - webview bridge taps (prototype-viewport coords + interactive flag,
 *    per prototype screen) → used to build heatmaps and misclick rate.
 *
 * For canvas-rendered prototypes (figma_proto) screen identity comes from
 * native frame captures: after every tap (debounced, so the transition
 * animation settles first) the WebView is snapshotted with view-shot and
 * uploaded; the backend clusters visually-identical frames into stable
 * screen keys and the timeline of those keys drives per-screen heatmaps.
 * This works for any prototype the WebView can display — it needs nothing
 * from the viewer (no DOM, no URL changes, no postMessage API).
 *
 * `active` splits mounting from running. TestRunnerScreen mounts this during
 * `task_intro` too, with `active={false}`, so the WebView spends the seconds
 * the participant is reading the task actually fetching Figma (DNS, TLS, the
 * viewer bundle, canvas boot) instead of starting cold the instant they tap
 * "Start task". While inactive nothing is recorded — no beats, no frame
 * captures, no task chrome — the WebView only loads. See the `active` guards
 * on onScreenChange / doCapture / onNavigationStateChange below.
 */
export function PlayerScreen({ active = true }: { active?: boolean }) {
  useKeepAwake();
  const { colors } = useTheme();
  const bootstrap = useSession((s) => s.bootstrap);
  const sessionId = useSession((s) => s.sessionId);
  const index = useSession((s) => s.currentTaskIndex);
  const completeTask = useSession((s) => s.completeTask);
  const [taskSheet, setTaskSheet] = useState(false);
  const [screenTapTick, setScreenTapTick] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [goalReached, setGoalReached] = useState(false);
  // Drives the loading veil. Without it the participant stares at the
  // WebView's own blank white page for the whole fetch — no spinner, no
  // context, nothing — until Figma's viewer boots far enough to draw its own
  // progress bar.
  const [ready, setReady] = useState(false);
  const currentScreenId = useRef<string>('entry');
  const webviewRef = useRef<WebView>(null);
  const captureAreaRef = useRef<View>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureBusy = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside WebView callbacks, which capture the value from the render
  // that installed them — a stale `active` there would let a preload write
  // beats into the session.
  const activeRef = useRef(active);
  activeRef.current = active;
  // Fires the auto-complete exactly once per task, even though the goal
  // screen can arrive from both signal sources (bridge + frame) and taps
  // can keep coming during the confirmation flash.
  const autoCompletedRef = useRef(false);
  // The screen the task STARTED on. A screen-matcher hit only counts once the
  // prototype has actually moved off it — otherwise a goal that happens to
  // describe the entry screen would complete the task the instant it begins.
  const armScreenRef = useRef<ScreenKey | null>(null);
  const lastScreenKeyRef = useRef<ScreenKey | null>(null);
  // Element hit waiting for its screen transition (see onGoalSignal).
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending timers on unmount — this screen is torn down between tasks
  // (task_questions) and a capture firing after that would post a frame
  // against a task the participant already left.
  useEffect(
    () => () => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
      if (readyTimer.current) clearTimeout(readyTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    [],
  );

  // The task just went live on a (possibly long) preloaded WebView: whatever
  // screen it is showing right now is this task's entry screen.
  useEffect(() => {
    if (!active) return;
    armScreenRef.current = lastScreenKeyRef.current;
  }, [active]);

  /** Records the auto-completion once and shows the confirmation modal. */
  const reachGoal = (meta: Record<string, string | number | boolean>) => {
    const activeTask = bootstrap?.tasks[index];
    if (!activeTask || autoCompletedRef.current) return;
    autoCompletedRef.current = true;
    if (graceTimer.current) clearTimeout(graceTimer.current);
    track('task_goal_reached', { taskId: activeTask.id, meta });
    // The app detected the goal itself — the participant never taps
    // "I completed this task". A modal offers the single next step
    // (next task, or finishing the session on the last one).
    setGoalReached(true);
  };

  /**
   * Single choke point for every prototype screen change, from either
   * signal source: the WebView hash bridge (DOM/hosted prototypes) or a
   * server-clustered frame `screenKey` (canvas prototypes). Records the
   * navigation and, for CANVAS (Figma) prototypes, auto-completes on the task's
   * declared success screen id.
   *
   * Structured goals (uploaded HTML, and any prototype the bridge can
   * fingerprint) do NOT come through here — they run through onGoalSignal and
   * the shared matcher, which knows about element fingerprints, authored screen
   * names and the entry-screen guard that a bare screen id can't express.
   */
  const onScreenChange = (screenId: string, source: 'webview' | 'frame') => {
    if (!screenId || screenId === currentScreenId.current) return;
    currentScreenId.current = screenId;
    // Preload: track the screen id so the first real capture is keyed
    // correctly, but emit nothing — the task hasn't started.
    if (!activeRef.current) return;
    const activeTask = bootstrap?.tasks[index];
    track('prototype_navigation', {
      taskId: activeTask?.id,
      meta: { prototypeScreenId: screenId, source, missionIndex: index },
    });
    // successScreenIds is the canvas-prototype path: frame clustering yields a
    // screen KEY and nothing else, so there is no signal to match on.
    if (bootstrap?.prototype.type !== 'figma_proto') return;
    const goals = activeTask?.successScreenIds ?? [];
    if (goals.includes(screenId)) reachGoal({ prototypeScreenId: screenId, source });
  };

  /**
   * The structured completion path: a `synth-signal` from synth's injected
   * tracker (uploaded HTML) or from PROTOTYPE_BRIDGE_JS (everything else),
   * evaluated by the SAME matcher the web tester flow uses.
   *
   * The guards, in order:
   *  - nothing counts before the task is active (the WebView preloads during
   *    task_intro, and this screen is remounted per task, so no signal can leak
   *    across task boundaries);
   *  - the first screen seen after arming IS the entry screen, and a screen hit
   *    must be a real move away from it;
   *  - an element hit on a goal that ALSO names a screen waits up to 1200ms for
   *    that transition, then completes anyway — a transition animation must not
   *    swallow the completion, and a stuck screen must not hang the task.
   */
  const onGoalSignal = (sig: GoalSignal) => {
    lastScreenKeyRef.current = sig.screen;
    if (!activeRef.current) return;
    const activeTask = bootstrap?.tasks[index];
    const goal = activeTask?.goal;
    if (!activeTask || !goal || autoCompletedRef.current) return;

    if (!armScreenRef.current) {
      armScreenRef.current = sig.screen;
      if (sig.kind === 'screen') return;
    }

    const hit = matchesGoal(goal, sig);
    if (!hit) return;

    if (hit.kind === 'screen' || hit.kind === 'url') {
      if (screenKeyEquals(armScreenRef.current, sig.screen)) return;
      reachGoal({ prototypeScreenId: screenIdFromKey(sig.screen), source: 'signal', via: hit.kind });
      return;
    }
    const wantsScreen = goal.any.some((m) => m.kind === 'screen' || m.kind === 'url');
    if (!wantsScreen) {
      reachGoal({ prototypeScreenId: screenIdFromKey(sig.screen), source: 'signal', via: hit.kind });
      return;
    }
    if (graceTimer.current) return;
    graceTimer.current = setTimeout(() => {
      graceTimer.current = null;
      reachGoal({
        prototypeScreenId: screenIdFromKey(sig.screen),
        source: 'signal',
        via: `${hit.kind}-timeout`,
      });
    }, 1200);
  };

  // Frames are captured for EVERY prototype type — heatmaps are built for
  // all sessions, and the clustered canonical frames double as the heatmap
  // background images. DOM-based prototypes additionally report screen ids
  // through the bridge; the backend reconciles both signals.
  const isFrameCaptured = true;

  const doCapture = async () => {
    if (!activeRef.current) return;
    if (!sessionId || captureBusy.current || !captureAreaRef.current) return;
    // Skip until the bridge has reported a real prototype screen id — a frame
    // captured under the placeholder 'entry' id pollutes the heatmap bases /
    // Mission Screens grid with a bogus "entry" screen.
    if (currentScreenId.current === 'entry') return;
    captureBusy.current = true;
    const atMs = sessionElapsedMs();
    try {
      const base64 = await captureRef(captureAreaRef, {
        format: 'jpg',
        quality: 0.55,
        result: 'base64',
        width: 390,
      });
      // The frame is keyed to the CURRENT screen (bridge node-id/hash) and
      // becomes the study's heatmap base image for that screen server-side.
      const { width: winW, height: winH } = Dimensions.get('window');
      const captureHeight = Math.round(390 * (winH / winW));
      const { screenKey, blank } = await uploadFrame(
        sessionId,
        base64,
        atMs,
        currentScreenId.current,
        390,
        captureHeight,
      );
      if (blank) {
        // Prototype still loading — try again shortly.
        captureTimer.current = setTimeout(() => void doCapture(), 1500);
        return;
      }
      if (screenKey) onScreenChange(screenKey, 'frame');
    } catch {
      // Frame evidence is best-effort; never disturb the participant.
    } finally {
      captureBusy.current = false;
    }
  };

  /** Debounced: capture ~900ms after the last tap so transitions settle. */
  const scheduleCapture = () => {
    setScreenTapTick((t) => t + 1);
    if (!isFrameCaptured || !activeRef.current) return;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => void doCapture(), 900);
  };

  // The task just started on an already-warm WebView: onLoadEnd fired during
  // the preload, so its capture kick-off was suppressed. Take the opening
  // frame now instead — otherwise the first frame for this task would only
  // arrive after the participant's first tap.
  useEffect(() => {
    if (!active || !isFrameCaptured) return;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => void doCapture(), 600);
    // doCapture reads everything it needs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    setTaskSheet(false);
    setScreenTapTick(0);
  }, [index]);

  if (!bootstrap) return null;
  const task = bootstrap.tasks[index];
  if (!task) return null;
  const uri = task.startUrl ?? bootstrap.prototype.entryUrl;
  // A task can auto-complete two ways: a structured goal (any prototype that can
  // emit a synth-signal, including uploaded HTML) or, for canvas prototypes,
  // a declared success screen id matched from clustered frames.
  const hasStructuredGoal = !!task.goal;
  const hasScreenIdGoal =
    bootstrap.prototype.type === 'figma_proto' && (task.successScreenIds?.length ?? 0) > 0;
  const hasGoal = hasStructuredGoal || hasScreenIdGoal;
  // Detection drives the UI, not the prototype TYPE: with a goal the app
  // confirms completion itself (GoalReachedModal) exactly like Figma does;
  // without one the task sheet keeps its manual "I completed this task", which
  // is also the web flow's behaviour for a free-explore mission.
  const requiresManualComplete = !hasGoal;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]} edges={['top', 'bottom']}>
      <TapOverlay
        taskId={task.id}
        getPrototypeScreenId={() => currentScreenId.current}
        onTap={scheduleCapture}
        enabled={active}
      >
        {loadError ? (
          <View style={[styles.errorBox, { backgroundColor: colors.paper }]}>
            <Text style={[type.h2, { color: colors.ink, marginBottom: spacing.sm }]}>
              Prototype failed to load
            </Text>
            <Text style={[type.body, { color: colors.ink3, marginBottom: spacing.lg, textAlign: 'center' }]}>
              Check your connection, then try again.
            </Text>
            <Button label="Retry" onPress={() => setLoadError(false)} />
            <Button label="Give up task" variant="ghost" onPress={() => completeTask('abandoned')} />
          </View>
        ) : (
          <View ref={captureAreaRef} collapsable={false} style={{ flex: 1 }}>
          <WebView
            ref={webviewRef}
            source={{ uri }}
            style={{ flex: 1 }}
            javaScriptEnabled
            domStorageEnabled
            allowsBackForwardNavigationGestures={false}
            // WKWebView's default UA lacks the "Safari/…" suffix, which
            // anti-bot layers (e.g. Cloudflare, in front of figma.com) treat
            // as an in-app browser and may serve a blank/challenged page.
            // Verified: same URL rendered fine in Safari while blank here.
            userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
            injectedJavaScript={PROTOTYPE_BRIDGE_JS}
            onLoadStart={() => setReady(false)}
            onLoadEnd={() => {
              webviewRef.current?.injectJavaScript(PROTOTYPE_BRIDGE_JS);
              // The document is done but Figma still has to boot its viewer and
              // paint the canvas — dropping the veil on onLoadEnd alone just
              // swaps our spinner for Figma's blank white page. Hold it a beat
              // longer so the hand-off lands on actual prototype pixels.
              if (readyTimer.current) clearTimeout(readyTimer.current);
              readyTimer.current = setTimeout(() => setReady(true), 1200);
              // Initial screen snapshot once the (possibly redirecting)
              // viewer settles.
              if (isFrameCaptured) {
                if (captureTimer.current) clearTimeout(captureTimer.current);
                captureTimer.current = setTimeout(() => void doCapture(), 2500);
              }
            }}
            onMessage={(e) => {
              let msg: {
                type?: string;
                kind?: string;
                screenId?: string;
                nx?: number;
                ny?: number;
                interactive?: boolean;
              };
              try {
                msg = JSON.parse(e.nativeEvent.data);
              } catch {
                return;
              }
              // Completion contract (see src/lib/goalMatch.ts) — from synth's
              // injected tracker on uploaded HTML, or from the bridge otherwise.
              if (msg.type === 'synth-signal') {
                const sig = parseGoalSignal(msg);
                if (sig) {
                  onGoalSignal(sig);
                  // A tracker screen signal is also a navigation for analytics;
                  // the bridge reports those separately as kind:'screen'.
                  if (sig.kind === 'screen') {
                    onScreenChange(screenIdFromKey(sig.screen), 'webview');
                  }
                }
                return;
              }
              if (msg.kind === 'screen' && msg.screenId) {
                onScreenChange(msg.screenId, 'webview');
              } else if (msg.kind === 'tap' && msg.nx !== undefined && msg.ny !== undefined) {
                const tapPayload = {
                  taskId: task.id,
                  normalizedX: Number(msg.nx.toFixed(4)),
                  normalizedY: Number(msg.ny.toFixed(4)),
                  screenWidth: Math.round(Dimensions.get('window').width),
                  screenHeight: Math.round(Dimensions.get('window').height),
                  meta: {
                    source: 'webview',
                    prototypeScreenId: msg.screenId ?? currentScreenId.current,
                    interactive: !!msg.interactive,
                    missionIndex: index,
                  },
                };
                if (!shouldExcludeTapFromHeatmap(tapPayload)) {
                  track('tap', tapPayload);
                }
              }
            }}
            onError={() => setLoadError(true)}
            // WebKit kills the content process under memory pressure and
            // leaves a silent white page (no onError). Reload recovers it.
            onContentProcessDidTerminate={() => webviewRef.current?.reload()}
            onNavigationStateChange={(nav) => {
              if (nav.url && activeRef.current) {
                track('prototype_navigation', { taskId: task.id, meta: { url: nav.url } });
              }
            }}
          />

          {/* Loading veil — covers the WebView's blank white page so the
              participant sees branded, explained progress instead of an empty
              screen. Sits INSIDE the capture area deliberately: a frame
              snapshotted while the prototype is still blank should look blank,
              and uploadFrame's `blank` detection reschedules on it. */}
          {!ready ? (
            <View style={[styles.veil, { backgroundColor: colors.paper }]} pointerEvents="none">
              <ActivityIndicator size="large" color={colors.brand} />
              <Text style={[type.h3, { color: colors.ink, marginTop: spacing.lg }]}>
                Getting the prototype ready
              </Text>
              <Text style={[type.caption, { color: colors.ink3, marginTop: 4, textAlign: 'center' }]}>
                This takes a moment on the first load.
              </Text>
            </View>
          ) : null}
          </View>
        )}
      </TapOverlay>

      <FloatingTaskControl
        taskIndex={index}
        taskTotal={bootstrap.tasks.length}
        taskTitle={task.title}
        onPress={() => setTaskSheet(true)}
        active={active && ready}
        screenTapTick={screenTapTick}
        sheetOpen={taskSheet}
      />

      <TaskSheet
        visible={active && ready && taskSheet}
        taskIndex={index}
        title={task.title}
        instruction={task.instruction}
        hasGoal={hasGoal}
        onComplete={
          requiresManualComplete
            ? () => {
                setTaskSheet(false);
                void completeTask('completed');
              }
            : undefined
        }
        onGiveUp={() => {
          setTaskSheet(false);
          completeTask('abandoned');
        }}
        onDismiss={() => setTaskSheet(false)}
      />

      {active && !requiresManualComplete && goalReached ? (
        <GoalReachedModal
          taskIndex={index}
          taskTitle={task.title}
          isLastTask={index === bootstrap.tasks.length - 1}
          onContinue={() => void completeTask('completed')}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
});
