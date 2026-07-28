import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, Callout, PageHeader, Screen } from '../components/ui';
import { resetToHome } from '../navigation';
import { describeLostSegments } from '../lib/failureMessages';
import { useSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';

/**
 * Upload + completion. The recording never blocks silently: the
 * participant sees the upload state, and failures offer retry while
 * the local file is preserved.
 */
export function UploadScreen() {
  const { colors } = useTheme();
  const phase = useSession((s) => s.phase);
  const progress = useSession((s) => s.uploadProgress);
  const error = useSession((s) => s.error);
  const failure = useSession((s) => s.failure);
  const retryUpload = useSession((s) => s.retryUpload);
  const finishWithoutRecording = useSession((s) => s.finishWithoutRecording);

  if (phase === 'upload_failed') {
    // `failure` names the actual cause (too large / offline / expired session /
    // server fault). `error` is the legacy plain-string path, kept as a fallback
    // so an older persisted snapshot still shows something useful.
    const title = failure?.title ?? 'Upload didn’t finish';
    const detail =
      failure?.detail ?? error ?? 'Your recording is saved safely on this device — nothing is lost.';
    return (
      <Screen
        footer={
          failure && !failure.retryable ? (
            // Retrying cannot change the outcome, so the only honest action is
            // to finish the session without this video.
            <Button label="Finish without the video" onPress={() => void finishWithoutRecording()} />
          ) : (
            <Button label="Try again" onPress={() => void retryUpload()} />
          )
        }
      >
        <PageHeader icon="upload-cloud" title={title} subtitle={detail} />
        {failure?.technical ? (
          <Callout icon="info">
            <Text style={[type.caption, { color: colors.ink3 }]}>
              Details for the research team: {failure.technical}
            </Text>
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
        <Text style={[type.h3, { color: colors.ink, marginTop: spacing.md }]}>{label}</Text>
        <Text style={[type.caption, { color: colors.ink3, marginTop: spacing.xs }]}>
          Please keep the app open until this finishes.
        </Text>
      </View>
    </Screen>
  );
}

export function DoneScreen() {
  const { colors } = useTheme();
  const reset = useSession((s) => s.reset);
  const lostSegments = useSession((s) => s.lostSegments);
  const lostSegmentReasons = useSession((s) => s.lostSegmentReasons);
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
          <Text style={[type.caption, { color: colors.ink }]}>
            {describeLostSegments(lostSegments, lostSegmentReasons)}
          </Text>
        </Callout>
      ) : null}
      <Callout icon="lock">
        <Text style={[type.caption, { color: colors.ink }]}>
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
