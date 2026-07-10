import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { track } from '../events/eventQueue';
import { RootStackParamList } from '../navigation';
import { useSession } from '../state/sessionStore';
import { ConsentScreen } from './ConsentScreen';
import { IntakeScreen } from './IntakeScreen';
import { PermissionScreen } from './PermissionScreen';
import { PlayerScreen } from './PlayerScreen';
import { QuestionsScreen } from './QuestionsScreen';
import { IncompatibleScreen, LinkErrorScreen, ResolvingScreen } from './StatusScreens';
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
