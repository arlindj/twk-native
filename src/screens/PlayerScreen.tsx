import { useKeepAwake } from '../native/keepAwake';
import React, { useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';
import { uploadFrame } from '../api/client';
import { TapOverlay } from '../components/TapOverlay';
import { Button } from '../components/ui';
import { sessionElapsedMs, track } from '../events/eventQueue';
import { useSession } from '../state/sessionStore';
import { colors, radius, spacing, type } from '../theme';

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
 */
export function PlayerScreen() {
  useKeepAwake();
  const bootstrap = useSession((s) => s.bootstrap);
  const sessionId = useSession((s) => s.sessionId);
  const index = useSession((s) => s.currentTaskIndex);
  const completeTask = useSession((s) => s.completeTask);
  const [taskSheet, setTaskSheet] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [goalReached, setGoalReached] = useState(false);
  const currentScreenId = useRef<string>('entry');
  const webviewRef = useRef<WebView>(null);
  const captureAreaRef = useRef<View>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureBusy = useRef(false);
  // Fires the auto-complete exactly once per task, even though the goal
  // screen can arrive from both signal sources (bridge + frame) and taps
  // can keep coming during the confirmation flash.
  const autoCompletedRef = useRef(false);

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
    const activeTask = bootstrap?.tasks[index];
    track('prototype_navigation', {
      taskId: activeTask?.id,
      meta: { prototypeScreenId: screenId, source },
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
    if (!sessionId || captureBusy.current || !captureAreaRef.current) return;
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
    if (!isFrameCaptured) return;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => void doCapture(), 900);
  };

  if (!bootstrap) return null;
  const task = bootstrap.tasks[index];
  if (!task) return null;
  const uri = task.startUrl ?? bootstrap.prototype.entryUrl;
  const hasGoal = (task.successScreenIds?.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TapOverlay
        taskId={task.id}
        getPrototypeScreenId={() => currentScreenId.current}
        onTap={scheduleCapture}
      >
        {loadError ? (
          <View style={styles.errorBox}>
            <Text style={[type.h2, { marginBottom: spacing.sm }]}>Prototype failed to load</Text>
            <Text style={[type.body, { marginBottom: spacing.lg, textAlign: 'center' }]}>
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
            onLoadEnd={() => {
              webviewRef.current?.injectJavaScript(PROTOTYPE_BRIDGE_JS);
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
                track('tap', {
                  taskId: task.id,
                  normalizedX: Number(msg.nx.toFixed(4)),
                  normalizedY: Number(msg.ny.toFixed(4)),
                  meta: {
                    source: 'webview',
                    prototypeScreenId: msg.screenId ?? currentScreenId.current,
                    interactive: !!msg.interactive,
                  },
                });
              }
            }}
            onError={() => setLoadError(true)}
            // WebKit kills the content process under memory pressure and
            // leaves a silent white page (no onError). Reload recovers it.
            onContentProcessDidTerminate={() => webviewRef.current?.reload()}
            onNavigationStateChange={(nav) => {
              if (nav.url) {
                track('prototype_navigation', { taskId: task.id, meta: { url: nav.url } });
              }
            }}
          />
          </View>
        )}
      </TapOverlay>

      {/* Floating task bar */}
      <View style={styles.bar}>
        <Pressable style={styles.barTask} onPress={() => setTaskSheet(true)}>
          <View style={styles.barDot} />
          <Text numberOfLines={1} style={styles.barText}>
            {task.title}
          </Text>
        </Pressable>
        <Pressable style={styles.barDone} onPress={() => setTaskSheet(true)}>
          <Text style={styles.barDoneText}>{hasGoal ? 'Stuck?' : 'Done?'}</Text>
        </Pressable>
      </View>

      {/* Task sheet */}
      <Modal visible={taskSheet} transparent animationType="slide" onRequestClose={() => setTaskSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setTaskSheet(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={type.h3}>Task {index + 1}</Text>
          <Text style={[type.h2, { marginTop: 4 }]}>{task.title}</Text>
          <Text style={[type.body, { marginTop: spacing.sm }]}>{task.instruction}</Text>
          <View style={{ marginTop: spacing.lg }}>
            {hasGoal ? (
              <Text style={[type.caption, { marginBottom: spacing.md }]}>
                This task finishes on its own once you reach the goal. Only use the
                button below if you can’t get there.
              </Text>
            ) : (
              <Button
                label="I completed the task"
                onPress={() => {
                  setTaskSheet(false);
                  completeTask('completed');
                }}
              />
            )}
            <Button
              label="I give up"
              variant="danger"
              onPress={() => {
                setTaskSheet(false);
                completeTask('abandoned');
              }}
            />
            <Button label="Continue testing" variant="ghost" onPress={() => setTaskSheet(false)} />
          </View>
        </View>
      </Modal>

      {/* Auto-complete modal — the app recognized the goal screen itself, so
          the participant only picks the next step (never "I completed it"). */}
      {goalReached ? (
        <View style={styles.goalOverlay}>
          <View style={styles.goalCard}>
            <View style={styles.goalCheck}>
              <Text style={styles.goalCheckMark}>✓</Text>
            </View>
            <Text style={styles.goalKicker}>Task {index + 1} complete</Text>
            <Text style={styles.goalTitle}>{task.title}</Text>
            <Text style={styles.goalSub}>Nice work — the app spotted you reached the goal.</Text>
            <View style={{ alignSelf: 'stretch', marginTop: spacing.sm }}>
              <Button
                label={
                  index === bootstrap.tasks.length - 1 ? 'Finish test' : 'Continue to next task'
                }
                onPress={() => void completeTask('completed')}
              />
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  bar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  barTask: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF5A5A' },
  barText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  barDone: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  barDoneText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: spacing.md,
  },
  goalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  goalCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl * 1.5,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  goalCheck: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalCheckMark: { color: '#fff', fontSize: 34, fontWeight: '800' },
  goalKicker: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalTitle: { ...type.h2, textAlign: 'center' },
  goalSub: { ...type.caption, textAlign: 'center' },
});
