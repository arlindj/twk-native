import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Callout, ListRow, PageHeader, Pill, SectionLabel } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';

/**
 * Consent — must be explicit before any recording. Explains exactly
 * what is captured: screen, taps, answers, device metadata.
 */
export function ConsentScreen() {
  const { colors } = useTheme();
  const bootstrap = useSession((s) => s.bootstrap);
  const acceptConsent = useSession((s) => s.acceptConsent);
  const [busy, setBusy] = useState(false);
  if (!bootstrap) return null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pill label={bootstrap.studyName} tone="muted" />
        <View style={{ marginTop: spacing.md }}>
          <PageHeader
            icon="file-text"
            title="Before you start"
            subtitle="You’re about to take part in a usability test. Here’s what will be collected during your session:"
          />
        </View>

        <SectionLabel>What we collect</SectionLabel>
        {bootstrap.recordingRequired ? (
          <ListRow
            icon="video"
            title="Screen recording"
            body="Only this app’s screen is recorded, from the first task until the end of the test."
          />
        ) : null}
        <ListRow icon="mouse-pointer" title="Taps and gestures" body="Where and when you tap while testing the prototype." />
        <ListRow icon="message-circle" title="Your answers" body="Responses to the questions in this study." />
        <ListRow
          icon="smartphone"
          title="Device info"
          body="Platform, OS version and screen size — used to make sense of the results."
          last
        />

        <Callout icon="lock" tone="brand" style={{ marginTop: spacing.md }}>
          <Text style={[type.body, { color: colors.brand700 }]}>{bootstrap.consent.body}</Text>
        </Callout>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.line }]}>
        <Button
          label="I agree — continue"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            await acceptConsent();
          }}
        />
        <Text style={[type.caption, { color: colors.ink3, textAlign: 'center', marginTop: spacing.sm }]}>
          Consent version {bootstrap.consent.version}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
