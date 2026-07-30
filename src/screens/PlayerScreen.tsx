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
import { shouldExcludeTapFromHeatmap } from '../lib/studyChrome';
import { useSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';

/**
 * Injected into the prototype WebView. Reports which prototype screen is
 * active, and viewport-normalized coordinates for every tap.
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
  document.addEventListener('touchstart', function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    var el = t.target && t.target.closest
      ? t.target.closest('a,button,input,select,textarea,[onclick],[role="button"]')
      : null;
    post({
      kind: 'tap',
      screenId: screenId(),
      nx: Math.max(0, Math.min(1, t.clientX / window.innerWidth)),
      ny: Math.max(0, Math.min(1, t.clientY / window.innerHeight)),
      interactive: !!el,
    });
  }, true);
  post({ kind: 'screen', screenId: screenId() });
  window.addEventListener('hashchange', function () {
    post({ kind: 'screen', screenId: screenId() });
  });
  // Some viewers update the URL via history.replaceState (no event) — poll.
  var lastScreen = screenId();
  setInterval(function () {
    var s = screenId();
    if (s !== lastScreen) {
      lastScreen = s;
      post({ kind: 'screen', screenId: s });
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

  // Clear pending timers on unmount — this screen is torn down between tasks
  // (task_questions) and a capture firing after that would post a frame
  // against a task the participant already left.
  useEffect(
    () => () => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
      if (readyTimer.current) clearTimeout(readyTimer.current);
    },
    [],
  );

  /**
   * Single choke point for every prototype screen change, from either
   * signal source: the WebView hash bridge (DOM/hosted prototypes) or a
   * server-clustered frame `screenKey` (canvas prototypes). Records the
   * navigation and, when the screen is the current task's declared goal,
   * auto-completes the task — no manual "I completed the task" tap
   * (Maze-style). Give-up stays an explicit action in the task sheet.
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
    const goals = activeTask?.successScreenIds ?? [];
    if (activeTask && !autoCompletedRef.current && goals.includes(screenId)) {
      autoCompletedRef.current = true;
      track('task_goal_reached', {
        taskId: activeTask.id,
        meta: { prototypeScreenId: screenId, source },
      });
      // The app detected the goal itself — the participant never taps
      // "I completed the task". A modal offers the single next step
      // (next task, or finishing the session on the last one).
      setGoalReached(true);
    }
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
  const hasGoal = (task.successScreenIds?.length ?? 0) > 0;

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
        onGiveUp={() => {
          setTaskSheet(false);
          completeTask('abandoned');
        }}
        onDismiss={() => setTaskSheet(false)}
      />

      {active && goalReached ? (
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
