import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Pill } from '../components/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../state/sessionStore';
import { colors, spacing, type } from '../theme';

/**
 * Consent — must be explicit before any recording. Explains exactly
 * what is captured: screen, taps, answers, device metadata.
 */
export function ConsentScreen() {
  const bootstrap = useSession((s) => s.bootstrap);
  const acceptConsent = useSession((s) => s.acceptConsent);
  const [busy, setBusy] = useState(false);
  if (!bootstrap) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pill label={bootstrap.studyName} />
        <Text style={[type.h1, { marginTop: spacing.md }]}>Before you start</Text>
        <Text style={[type.body, { marginTop: spacing.sm }]}>
          You’re about to take part in a usability test. Here’s what will be collected during your
          session:
        </Text>

        <Card style={{ marginTop: spacing.lg, gap: spacing.md }}>
          <ConsentRow
            title="Screen recording"
            body="Only this app’s screen is recorded, from the first task until the end of the test."
            show={bootstrap.recordingRequired}
          />
          <ConsentRow title="Taps and gestures" body="Where and when you tap while testing the prototype." show />
          <ConsentRow title="Your answers" body="Responses to the questions in this study." show />
          <ConsentRow
            title="Device info"
            body="Platform, OS version and screen size — used to make sense of the results."
            show
          />
        </Card>

        <Card style={{ marginTop: spacing.md, backgroundColor: colors.brandLight, borderColor: colors.brandMuted }}>
          <Text style={[type.body, { color: colors.brandDark }]}>{bootstrap.consent.body}</Text>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="I agree — continue"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            await acceptConsent();
          }}
        />
        <Text style={[type.caption, { textAlign: 'center', marginTop: spacing.sm }]}>
          Consent version {bootstrap.consent.version}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function ConsentRow({ title, body, show }: { title: string; body: string; show: boolean }) {
  if (!show) return null;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text style={type.h3}>{title}</Text>
        <Text style={type.body}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg },
  footer: { padding: spacing.lg, paddingTop: 0 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
    marginTop: 8,
  },
});
