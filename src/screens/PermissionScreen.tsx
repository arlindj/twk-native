import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { colors, spacing, type } from '../theme';

/**
 * Recording permission — the OS dialog (ReplayKit on iOS,
 * MediaProjection consent on Android) is triggered from here.
 * If the study requires recording and the user denies, the test
 * cannot start; we explain that instead of failing silently.
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
          {unavailable && __DEV__ ? (
            // Dev-only escape hatch: simulators can't record, but the rest
            // of the flow must stay testable. Production builds keep the
            // study's recordingRequired policy strict.
            <Button
              label="Continue without recording (dev)"
              variant="ghost"
              onPress={skipRecordingUnavailable}
            />
          ) : null}
        </>
      }
    >
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={styles.iconWrap}>
          <Text style={{ fontSize: 34 }}>🎥</Text>
        </View>
        <Text style={[type.h1, { marginBottom: spacing.sm }]}>Screen recording</Text>
        <Text style={type.body}>
          This study needs a screen recording of your test session.{' '}
          {Platform.OS === 'ios'
            ? 'iOS will ask for your permission when the recording starts.'
            : 'Android will show a system dialog asking you to allow screen capture.'}
        </Text>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={type.h3}>What is recorded</Text>
          <Text style={type.body}>
            Only what happens inside this app during the test. Recording stops automatically when
            you finish, and you’ll see it uploading before the session completes.
          </Text>
        </Card>

        {denied && (
          <Card style={{ marginTop: spacing.md, backgroundColor: colors.dangerBg, borderColor: '#F4B7B0' }}>
            <Text style={[type.h3, { color: colors.danger }]}>
              {unavailable ? 'Recording not available' : 'Permission was denied'}
            </Text>
            <Text style={[type.body, { color: colors.danger }]}>
              {unavailable
                ? 'Screen recording isn’t available in this environment (e.g. simulator or Expo Go). Run a development build on a real device to record.'
                : 'This study requires screen recording, so the test can’t start without it. Tap “Try again” to see the permission dialog once more.'}
            </Text>
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.brandLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
});
