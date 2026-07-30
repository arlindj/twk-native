import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Callout, PageHeader, Screen } from '../components/ui';
import { Nav } from '../navigation';
import { dismissResumableSession, findResumableSession, ResumableSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';

/** Roughly-phrased elapsed time — good enough for "was this recent?", not a clock. */
function timeAgo(updatedAt: number): string {
  if (!updatedAt) return '';
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** What's actually left to do, in the participant's terms — only phases that
 *  can be resumed (see RESUMABLE_PHASES) reach this screen. */
function progressLine(session: ResumableSession): string {
  const { phase, resultsSubmitted, currentTaskIndex, totalTasks } = session;
  if (resultsSubmitted) return 'Your answers were already sent. Only the recording is left to upload.';
  if (phase === 'uploading') return 'Submitting your results…';
  if (phase === 'upload_failed' || phase === 'upload_metered') return 'Your results haven’t finished sending yet.';
  if (phase === 'consent' || phase === 'intake' || phase === 'permission') return 'You hadn’t started the tasks yet.';
  if (totalTasks > 0) return `Task ${currentTaskIndex + 1} of ${totalTasks}.`;
  return 'In progress.';
}

/**
 * Gate screen, shown instead of Home when this device has an unfinished
 * session — its own screen rather than a banner mixed into the welcome UI,
 * so a participant returning to a real decision ("continue, or start fresh?")
 * isn't scanning past QR/link buttons that don't apply to them right now.
 */
export function ResumeSessionScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const [session, setSession] = useState<ResumableSession | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void findResumableSession().then((s) => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to resume (cleared between the App.tsx check and this mounting,
  // or called directly) — fall back to the normal welcome screen.
  useEffect(() => {
    if (session === null) navigation.replace('Home');
  }, [session, navigation]);

  if (!session) return null;

  return (
    <Screen
      footer={
        <>
          <Button
            label="Continue unfinished test"
            onPress={() => navigation.replace('TestRunner', { token: session.testToken })}
          />
          <Button
            label="Close and start a new test"
            variant="ghost"
            onPress={() => {
              dismissResumableSession();
              navigation.replace('Home');
            }}
          />
        </>
      }
    >
      <PageHeader
        icon="rotate-ccw"
        title="Unfinished test"
        subtitle={
          session.studyName
            ? `You have an unfinished session for "${session.studyName}" on this phone.`
            : 'You have an unfinished test session on this phone.'
        }
      />
      <Callout icon="info">
        <Text style={[type.body, { color: colors.ink }]}>{progressLine(session)}</Text>
        {session.updatedAt ? (
          <Text style={[type.caption, { color: colors.ink3, marginTop: spacing.xs }]}>
            Last active {timeAgo(session.updatedAt)}.
          </Text>
        ) : null}
      </Callout>
      <Text style={[type.caption, { color: colors.ink3, marginTop: spacing.lg }]}>
        Closing this discards the unfinished session. Nothing already submitted to the study is
        affected, but anything still only on this phone (like an unsent recording) is lost.
      </Text>
    </Screen>
  );
}
