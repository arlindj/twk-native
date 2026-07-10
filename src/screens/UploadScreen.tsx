import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { colors, spacing, type } from '../theme';

/**
 * Upload + completion. The recording never blocks silently: the
 * participant sees the upload state, and failures offer retry while
 * the local file is preserved.
 */
export function UploadScreen() {
  const phase = useSession((s) => s.phase);
  const progress = useSession((s) => s.uploadProgress);
  const error = useSession((s) => s.error);
  const retryUpload = useSession((s) => s.retryUpload);

  if (phase === 'upload_failed') {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={[type.h2, { marginBottom: spacing.sm }]}>Upload didn’t finish</Text>
          <Text style={[type.body, { textAlign: 'center', marginBottom: spacing.xs }]}>
            Your recording is saved safely on this device — nothing is lost.
          </Text>
          {error ? <Text style={[type.caption, { marginBottom: spacing.lg }]}>{error}</Text> : null}
          <Button label="Retry upload" onPress={() => void retryUpload()} />
        </View>
      </Screen>
    );
  }

  const label =
    progress?.state === 'uploading'
      ? 'Uploading your recording…'
      : progress?.state === 'finalizing'
        ? 'Finalizing…'
        : 'Wrapping up your session…';

  return (
    <Screen>
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={[type.h3, { marginTop: spacing.md }]}>{label}</Text>
        <Text style={[type.caption, { marginTop: spacing.xs }]}>
          Please keep the app open until this finishes.
        </Text>
      </View>
    </Screen>
  );
}

export function DoneScreen() {
  const reset = useSession((s) => s.reset);
  return (
    <Screen>
      <View style={styles.center}>
        <View style={styles.check}>
          <Text style={{ fontSize: 40, color: '#fff' }}>✓</Text>
        </View>
        <Text style={[type.h1, { marginTop: spacing.lg }]}>Thank you!</Text>
        <Text style={[type.body, { textAlign: 'center', marginTop: spacing.sm }]}>
          Your test session was submitted. You can close the app now.
        </Text>
        <Card style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}>
          <Text style={type.caption}>
            Your recording, taps and answers were sent securely to the research team. Recordings
            are kept only as long as the study’s retention policy allows.
          </Text>
        </Card>
        <View style={{ alignSelf: 'stretch', marginTop: spacing.lg }}>
          <Button
            label="Done"
            variant="secondary"
            onPress={() => {
              reset();
              router.replace('/');
            }}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  check: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
