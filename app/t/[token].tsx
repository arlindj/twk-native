import { useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { ConsentScreen } from '../../src/screens/ConsentScreen';
import { IntakeScreen } from '../../src/screens/IntakeScreen';
import { PermissionScreen } from '../../src/screens/PermissionScreen';
import { PlayerScreen } from '../../src/screens/PlayerScreen';
import { QuestionsScreen } from '../../src/screens/QuestionsScreen';
import { IncompatibleScreen, LinkErrorScreen, ResolvingScreen } from '../../src/screens/StatusScreens';
import { TaskIntroScreen } from '../../src/screens/TaskIntroScreen';
import { DoneScreen, UploadScreen } from '../../src/screens/UploadScreen';
import { track } from '../../src/events/eventQueue';
import { useSession } from '../../src/state/sessionStore';

/**
 * Test session runner. This route is the deep-link target:
 *   https://test.tawakkalnaos.app/t/<token>  -> app opens here
 *   twk://t/<token>                          -> same
 * The whole participant flow is phase-driven from the session store,
 * so OS-level interruptions and retries never desync navigation.
 */
export default function TestRunner() {
  const { token, api } = useLocalSearchParams<{ token: string; api?: string }>();
  const phase = useSession((s) => s.phase);
  const currentTaskIndex = useSession((s) => s.currentTaskIndex);
  const resolveFromToken = useSession((s) => s.resolveFromToken);

  useEffect(() => {
    if (token) void resolveFromToken(token, api);
  }, [token, api, resolveFromToken]);

  // Evidence for "user left the app" failure state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') track('app_backgrounded');
      if (state === 'active') track('app_foregrounded');
    });
    return () => sub.remove();
  }, []);

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
      return <TaskIntroScreen />;
    case 'testing':
      return <PlayerScreen />;
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
