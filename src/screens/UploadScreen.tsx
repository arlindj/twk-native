import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, Callout, PageHeader, Screen } from '../components/ui';
import { resetToHome } from '../navigation';
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
      <Screen footer={<Button label="Retry upload" onPress={() => void retryUpload()} />}>
        <PageHeader
          icon="upload-cloud"
          title="Upload didn’t finish"
          subtitle="Your recording is saved safely on this device — nothing is lost."
        />
        {error ? (
          <Callout icon="alert-triangle" tone="warning">
            <Text style={type.caption}>{error}</Text>
          </Callout>
        ) : null}
      </Screen>
    );
  }

  const segmentSuffix =
    progress && progress.totalSegments > 1 ? ` (part ${progress.segment} of ${progress.totalSegments})` : '';
  const label =
    progress?.state === 'uploading'
      ? `Uploading your recording${segmentSuffix}…`
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
  const lostSegments = useSession((s) => s.lostSegments);
  return (
    <Screen
      footer={
        <Button
          label="Done"
          variant="secondary"
          onPress={() => {
            reset();
            resetToHome();
          }}
        />
      }
    >
      <PageHeader
        icon="check-circle"
        title="Thank you!"
        subtitle="Your test session was submitted. You can close the app now."
      />
      {lostSegments > 0 ? (
        <Callout icon="alert-triangle" tone="warning">
          <Text style={type.caption}>
            {lostSegments === 1
              ? 'One part of the screen recording could not be saved, but your taps and answers were submitted in full.'
              : `${lostSegments} parts of the screen recording could not be saved, but your taps and answers were submitted in full.`}
          </Text>
        </Callout>
      ) : null}
      <Callout icon="lock">
        <Text style={type.caption}>
          Your recording, taps and answers were sent securely to the research team. Recordings are
          kept only as long as the study’s retention policy allows.
        </Text>
      </Callout>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
});
