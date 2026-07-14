import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Callout, ListRow, PageHeader, Screen, SectionLabel } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { colors, spacing, type } from '../theme';

/**
 * Recording permission checkpoint. The actual OS dialog (ReplayKit /
 * MediaProjection) fires when the first task starts — here we only
 * explain what's recorded and verify the device can record. If the
 * study requires recording and it's unavailable/denied, we explain
 * instead of failing silently.
 */
export function PermissionScreen() {
  const phase = useSession((s) => s.phase);
  const error = useSession((s) => s.error);
  const grantRecording = useSession((s) => s.grantRecording);
  const skipRecordingUnavailable = useSession((s) => s.skipRecordingUnavailable);
  const [busy, setBusy] = useState(false);

  const denied = phase === 'permission_denied';
  const unavailable = denied && error === 'recording_unavailable';

  return (
    <Screen
      footer={
        <>
          <Button
            label={denied ? 'Try again' : 'Enable screen recording'}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              await grantRecording();
              setBusy(false);
            }}
          />
          {denied ? (
            // A device that genuinely can't record (or a participant who
            // keeps denying the OS dialog) must not be a dead end: the
            // session continues without video — taps, events and answers
            // are still collected — and is flagged for the dashboard.
            <Button
              label="Continue without recording"
              variant="ghost"
              onPress={skipRecordingUnavailable}
            />
          ) : null}
        </>
      }
    >
      <View>
        <PageHeader
          icon="video"
          title="Screen recording"
          subtitle={`This study records your screen — but only while you’re doing the tasks. ${
            Platform.OS === 'ios'
              ? 'iOS will ask for your permission when the first task starts.'
              : 'Android will show a system dialog asking you to allow screen capture when the first task starts.'
          }`}
        />

        <SectionLabel>What is recorded</SectionLabel>
        <ListRow
          icon="target"
          title="Only the tasks"
          body="Nothing before the first task (your name, this screen) and nothing after the last task."
        />
        <ListRow
          icon="log-out"
          title="Stops if you leave"
          body="Leaving the app stops the recording immediately — other apps are never captured."
          last
        />

        {denied && (
          <Callout icon="alert-triangle" tone="danger" style={{ marginTop: spacing.md }}>
            <Text style={[type.h3, { color: colors.danger }]}>
              {unavailable ? 'Recording not available' : 'Permission was denied'}
            </Text>
            <Text style={[type.body, { color: colors.danger, marginTop: 2 }]}>
              {unavailable
                ? 'Screen recording isn’t available on this device or environment (e.g. simulator). The test needs a real phone to record.'
                : 'This study requires screen recording, so the test can’t continue without it. Tap “Try again” — the system dialog will appear again when the task starts.'}
            </Text>
          </Callout>
        )}
      </View>
    </Screen>
  );
}
