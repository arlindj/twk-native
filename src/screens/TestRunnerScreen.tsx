import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useEffect } from 'react';
import { Alert, AppState, BackHandler, StyleSheet, View } from 'react-native';
import { RootStackParamList } from '../navigation';
import { useSession } from '../state/sessionStore';
import { ConsentScreen } from './ConsentScreen';
import { GraphPlayerScreen } from './GraphPlayerScreen';
import { IntakeScreen } from './IntakeScreen';
import { PermissionScreen } from './PermissionScreen';
import { PlayerScreen } from './PlayerScreen';
import { QuestionsScreen } from './QuestionsScreen';
import { IncompatibleScreen, InterruptedScreen, LinkErrorScreen, ResolvingScreen } from './StatusScreens';
import { TaskIntroScreen } from './TaskIntroScreen';
import { DoneScreen, UploadScreen } from './UploadScreen';

/**
 * Test session runner. This route is the deep-link target:
 *   https://test.tawakkalnaos.app/t/<token>  -> app opens here
 *   twk://t/<token>                          -> same
 * The whole participant flow is phase-driven from the session store,
 * so OS-level interruptions and retries never desync navigation.
 */
export function TestRunnerScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'TestRunner'>>();
  const token = params?.token;
  const api = params?.api;
  const phase = useSession((s) => s.phase);
  const currentTaskIndex = useSession((s) => s.currentTaskIndex);
  const isGraphPrototype = useSession((s) => s.bootstrap?.prototype.type === 'figma_graph');
  const resolveFromToken = useSession((s) => s.resolveFromToken);
  const handleAppState = useSession((s) => s.handleAppState);

  useEffect(() => {
    if (token) void resolveFromToken(token, api);
  }, [token, api, resolveFromToken]);

  // Lifecycle: leaving the app mid-test stops the recording segment and
  // parks the session in `interrupted` (see sessionStore.handleAppState).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background' || state === 'inactive') {
        void handleAppState(state);
      }
    });
    return () => sub.remove();
  }, [handleAppState]);

  // Android hardware back mid-session would silently kill the test.
  // Block it during active phases; on terminal phases the default
  // behavior (leave/exit) is fine.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const p = useSession.getState().phase;
      const terminal = p === 'done' || p === 'link_error' || p === 'incompatible' || p === 'idle';
      if (terminal) return false;
      Alert.alert(
        'Leave the test?',
        'Your progress and recording for this session will be lost.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => {
              useSession.getState().reset();
              BackHandler.exitApp();
            },
          },
        ],
      );
      return true;
    });
    return () => sub.remove();
  }, []);

  // URL-backed prototypes (figma_proto / live_url) used to start loading only
  // once the participant tapped "Start task" — so the first thing they saw of
  // the test was the WebView's blank white page for the length of a cold Figma
  // load (no spinner, no context) until Figma's own viewer booted far enough to
  // draw its progress bar.
  //
  // Both phases render the player at the SAME position with the same `key`, so
  // React reuses the element and the WebView survives the transition: it starts
  // fetching during `task_intro` (inactive, nothing recorded — see PlayerScreen's
  // `active` guards) while the participant reads the task, and "Start task" only
  // lifts the intro off an already-warm prototype. Putting the player inside the
  // phase switch instead would change its position in the tree between phases,
  // remounting the WebView and refetching from scratch.
  //
  // Graph prototypes render from bundled images with no page to fetch, so they
  // stay on the plain switch below — there is nothing to warm up.
  if (!isGraphPrototype && (phase === 'task_intro' || phase === 'testing')) {
    const testing = phase === 'testing';
    return (
      <View style={styles.fill}>
        {/* key per task: a task can carry its own startUrl. */}
        <PlayerScreen key={currentTaskIndex} active={testing} />
        {!testing ? (
          <View style={StyleSheet.absoluteFill}>
            <TaskIntroScreen />
          </View>
        ) : null}
      </View>
    );
  }

  switch (phase) {
    case 'idle':
    case 'resolving':
      return <ResolvingScreen />;
    case 'link_error':
      return <LinkErrorScreen />;
    case 'incompatible':
      return <IncompatibleScreen />;
    case 'consent':
      return <ConsentScreen />;
    case 'intake':
      return <IntakeScreen />;
    case 'permission':
    case 'permission_denied':
      return <PermissionScreen />;
    case 'task_intro':
      // Non-graph prototypes never reach here — handled by the preload branch
      // above.
      return <TaskIntroScreen />;
    case 'testing':
      // A confirmed clickable Figma graph has no URL to load — it renders
      // natively (screens-as-images + hotspots). Remounted per task, like
      // the web GraphPlayer's `key={current.id}`: each mission restarts
      // from the study's shared graph start screen.
      return <GraphPlayerScreen key={currentTaskIndex} />;
    case 'interrupted':
      return <InterruptedScreen />;
    case 'task_questions':
    case 'post_questions':
      // Distinct key per question checkpoint so the screen remounts with fresh
      // local state (index, answers, busy) instead of reusing the previous
      // checkpoint's instance.
      return <QuestionsScreen key={`${phase}-${currentTaskIndex}`} />;
    case 'uploading':
    case 'upload_failed':
      return <UploadScreen />;
    case 'done':
      return <DoneScreen />;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
