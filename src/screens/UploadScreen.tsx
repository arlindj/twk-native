import React, { useEffect } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { Button, Callout, CircularProgress, PageHeader, Screen } from '../components/ui';
import { resetToHome } from '../navigation';
import { onConnectivityChange } from '../lib/connectivity';
import { describeLostSegments, formatBytes } from '../lib/failureMessages';
import { useKeepAwake } from '../native/keepAwake';
import { useSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';

/**
 * Upload + completion. The recording never blocks silently: the
 * participant sees the upload state, and failures offer retry while
 * the local file is preserved.
 *
 * Since the session now submits answers, outcomes and beats *before* the video
 * (see sessionStore.finishSession), this screen has two very different jobs and
 * must never confuse them: before `resultsSubmitted` the participant's data is
 * still only on the phone and closing the app loses it; after it, the study
 * already has everything except the video.
 */
export function UploadScreen() {
  const { colors } = useTheme();
  const phase = useSession((s) => s.phase);
  const progress = useSession((s) => s.uploadProgress);
  const error = useSession((s) => s.error);
  const failure = useSession((s) => s.failure);
  const resultsSubmitted = useSession((s) => s.resultsSubmitted);
  const submitting = useSession((s) => s.submitting);
  const pendingUploadBytes = useSession((s) => s.pendingUploadBytes);
  const waitingForWifi = useSession((s) => s.waitingForWifi);
  const retryUpload = useSession((s) => s.retryUpload);
  const finishWithoutRecording = useSession((s) => s.finishWithoutRecording);
  const uploadOverMeteredConnection = useSession((s) => s.uploadOverMeteredConnection);
  const waitForWifiThenUpload = useSession((s) => s.waitForWifiThenUpload);

  // A multi-minute transfer must not be interrupted by the screen locking:
  // on iOS a locked screen suspends the JS thread exactly like backgrounding.
  useKeepAwake();

  // Coming back to the app is the strongest signal we get that conditions may
  // have changed — the participant very often left precisely to join Wi-Fi or
  // walk somewhere with signal. Resume automatically instead of making them
  // find the button again. Safe to call unconditionally: finishSession is
  // guarded against re-entry, every step is idempotent, and finalize is skipped
  // once `resultsSubmitted` is set.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const s = useSession.getState();
      if (s.submitting) return;
      const stalled = s.phase === 'uploading';
      const recoverable = s.phase === 'upload_failed' && s.failure?.retryable !== false;
      if (stalled || recoverable) void s.retryUpload();
    });
    return () => sub.remove();
  }, []);

  // Parked waiting for Wi-Fi: resume the moment an unmetered connection shows
  // up. Subscribed from the screen rather than the store so it can never
  // outlive the session it belongs to.
  useEffect(() => {
    if (phase !== 'upload_metered' || !waitingForWifi) return;
    const unsubscribe = onConnectivityChange((info) => {
      if (info.online && !info.expensive) void uploadOverMeteredConnection();
    });
    return unsubscribe;
  }, [phase, waitingForWifi, uploadOverMeteredConnection]);

  // ---- Large video on a connection that costs the participant money -------
  if (phase === 'upload_metered') {
    const size = formatBytes(pendingUploadBytes ?? 0);
    if (waitingForWifi) {
      return (
        <Screen
          footer={
            <Button
              label={`Send now over mobile data (${size})`}
              variant="secondary"
              onPress={() => void uploadOverMeteredConnection()}
              disabled={submitting}
            />
          }
        >
          <PageHeader
            icon="wifi"
            title="Waiting for Wi-Fi"
            subtitle={`Your answers are already submitted. The ${size} screen recording will send by itself as soon as you are on Wi-Fi — keep the app open.`}
          />
          <View style={styles.spinnerRow}>
            <ActivityIndicator color={colors.brand} />
          </View>
          <Callout icon="check-circle">
            <Text style={[type.caption, { color: colors.ink }]}>
              Nothing is at risk while you wait. You can also finish now and skip the video.
            </Text>
          </Callout>
          <Button
            label="Finish without the video"
            variant="ghost"
            onPress={() => void finishWithoutRecording()}
            disabled={submitting}
          />
        </Screen>
      );
    }
    return (
      <Screen
        footer={
          <>
            <Button
              label={`Send now (${size})`}
              onPress={() => void uploadOverMeteredConnection()}
              disabled={submitting}
            />
            <Button label="Wait for Wi-Fi" variant="secondary" onPress={waitForWifiThenUpload} />
          </>
        }
      >
        <PageHeader
          icon="upload-cloud"
          title="Send the recording over mobile data?"
          subtitle={`Your answers are already submitted. The screen recording is ${size}, and you are on a mobile connection — sending it now will use your data allowance.`}
        />
        <Callout icon="check-circle">
          <Text style={[type.caption, { color: colors.ink }]}>
            Whatever you choose, your test results are safe. Waiting only delays the video.
          </Text>
        </Callout>
        <Button
          label="Finish without the video"
          variant="ghost"
          onPress={() => void finishWithoutRecording()}
          disabled={submitting}
        />
      </Screen>
    );
  }

  if (phase === 'upload_failed') {
    // `failure` names the actual cause (too large / offline / expired session /
    // server fault). `error` is the legacy plain-string path, kept as a fallback
    // so an older persisted snapshot still shows something useful.
    const title = failure?.title ?? 'Upload didn’t finish';
    const detail =
      failure?.detail ?? error ?? 'Your recording is saved safely on this device — nothing is lost.';
    // "Finish without the video" is only an honest offer once the results are
    // in. Before that, skipping would discard the participant's answers, so the
    // single option is to keep trying.
    const canSkipVideo = resultsSubmitted;
    return (
      <Screen
        footer={
          failure && !failure.retryable ? (
            // Retrying cannot change the outcome, so the only honest action is
            // to finish the session without this video.
            <Button
              label="Finish without the video"
              onPress={() => void finishWithoutRecording()}
              disabled={submitting}
            />
          ) : (
            <>
              <Button label="Try again" onPress={() => void retryUpload()} disabled={submitting} />
              {canSkipVideo ? (
                <Button
                  label="Finish without the video"
                  variant="secondary"
                  onPress={() => void finishWithoutRecording()}
                  disabled={submitting}
                />
              ) : null}
            </>
          )
        }
      >
        <PageHeader icon="upload-cloud" title={title} subtitle={detail} />
        {resultsSubmitted ? (
          <Callout icon="check-circle">
            <Text style={[type.caption, { color: colors.ink }]}>
              Your answers, task results and taps are already submitted. Only the screen recording
              is still waiting.
            </Text>
          </Callout>
        ) : (
          <Callout icon="alert-triangle" tone="warning">
            <Text style={[type.caption, { color: colors.ink }]}>
              Your session has not reached the study yet. Everything you did is saved on this
              phone — please keep the app installed and try again.
            </Text>
          </Callout>
        )}
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
  // Before the results are in, the wording must not talk about the recording —
  // that is not what is being sent yet.
  const label = !resultsSubmitted
    ? 'Submitting your session…'
    : progress?.state === 'uploading'
      ? `Uploading your recording${segmentSuffix}…`
      : progress?.state === 'requesting_url'
        ? 'Preparing the upload…'
        : progress?.state === 'finalizing'
          ? 'Finalizing…'
          : progress?.state === 'failed_retryable'
            ? 'Connection lost — retrying…'
            : 'Wrapping up your session…';

  // A spinner alone made 5% and 95% look identical, so giving up on a nearly
  // finished transfer was the rational move. Show the real byte progress.
  const fraction = progress?.state === 'uploading' ? progress.fraction : undefined;
  const hasProgress = fraction != null;

  return (
    <Screen>
      <View style={styles.center}>
        {/* A determinate ring, not a plain spinner: a spinning circle only
            ever says "something is happening", so a nearly-finished transfer
            and one that just started look identical, and giving up on either
            reads the same. Below (before there is a real byte count — still
            submitting answers, requesting the upload URL, finalizing) an
            ordinary indeterminate spinner is the honest signal, since there
            is genuinely nothing to measure yet. */}
        {hasProgress ? (
          <CircularProgress progress={fraction} size={112} strokeWidth={10}>
            <Text style={[type.h2, { color: colors.ink }]}>{Math.round(fraction * 100)}%</Text>
          </CircularProgress>
        ) : (
          <ActivityIndicator size="large" color={colors.brand} />
        )}
        <Text style={[type.h3, styles.label, { color: colors.ink }]}>{label}</Text>
        {hasProgress && progress?.totalBytes ? (
          <Text style={[type.caption, styles.progressCaption, { color: colors.ink3 }]}>
            {formatBytes(progress.totalBytes)}
          </Text>
        ) : null}
        <Text style={[type.caption, styles.hint, { color: colors.ink3 }]}>
          {resultsSubmitted
            ? 'Your answers are already submitted. Please keep the app open while the video sends.'
            : 'Please keep the app open until this finishes.'}
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
  label: { marginTop: spacing.md, textAlign: 'center' },
  hint: { marginTop: spacing.xs, textAlign: 'center' },
  progressCaption: { marginTop: spacing.xs, textAlign: 'center' },
  spinnerRow: { alignItems: 'center', paddingVertical: spacing.md },
});
