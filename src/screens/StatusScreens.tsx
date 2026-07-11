import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Callout, PageHeader, Screen } from '../components/ui';
import { resetToHome } from '../navigation';
import { useSession } from '../state/sessionStore';
import { colors, spacing, type } from '../theme';

export function ResolvingScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={type.body}>Preparing your test…</Text>
      </View>
    </Screen>
  );
}

export function LinkErrorScreen() {
  const error = useSession((s) => s.error);
  const reset = useSession((s) => s.reset);
  return (
    <Screen
      footer={
        <Button
          label="Back to home"
          onPress={() => {
            reset();
            resetToHome();
          }}
        />
      }
    >
      <PageHeader icon="link" title="This test can’t be opened" />
      <Callout icon="alert-triangle" tone="warning">
        <Text style={type.body}>{error}</Text>
      </Callout>
    </Screen>
  );
}

/**
 * Shown when the participant left the app mid-test. Recording was
 * stopped the moment the app went to the background (nothing outside
 * the test is ever captured); resuming starts a fresh segment.
 */
export function InterruptedScreen() {
  const resumeTest = useSession((s) => s.resumeTest);
  const recordingEnabled = useSession((s) => s.recordingEnabled);
  const [busy, setBusy] = React.useState(false);
  return (
    <Screen
      footer={
        <Button
          label="Continue test"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            await resumeTest();
            setBusy(false);
          }}
        />
      }
    >
      <PageHeader
        icon="pause-circle"
        title="Test paused"
        subtitle={`You left the app, so the test was paused${
          recordingEnabled
            ? ' and the screen recording was stopped — nothing outside this app is ever recorded'
            : ''
        }.`}
      />
      <Callout icon="play-circle">
        <Text style={type.body}>
          You can continue right where you left off.
          {recordingEnabled ? ' Recording will start again when you continue.' : ''}
        </Text>
      </Callout>
    </Screen>
  );
}

export function IncompatibleScreen() {
  const reset = useSession((s) => s.reset);
  return (
    <Screen
      footer={
        <Button
          label="Back to home"
          onPress={() => {
            reset();
            resetToHome();
          }}
        />
      }
    >
      <PageHeader
        icon="monitor"
        title="Not a mobile test"
        subtitle="This study was built for desktop and can’t run in the mobile app. Please open the test link on a computer instead."
      />
    </Screen>
  );
}
