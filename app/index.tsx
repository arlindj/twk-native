import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Screen } from '../src/components/ui';
import { parseTestLink } from '../src/linkParser';
import { colors, radius, spacing, type } from '../src/theme';

/**
 * Home — the app is a participant runtime, so the only actions are
 * "open a test": scan the QR from the web dashboard, or paste the
 * test link / code manually. (Deep links skip this screen entirely.)
 */
export default function Home() {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openTest = () => {
    const parsed = parseTestLink(input);
    if (!parsed) {
      setError('That does not look like a valid test link or code.');
      return;
    }
    setError(null);
    router.push({
      pathname: '/t/[token]',
      params: { token: parsed.token, ...(parsed.apiOverride ? { api: parsed.apiOverride } : {}) },
    });
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>T</Text>
          </View>
          <Text style={styles.brandName}>TWK Participate</Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={[type.h1, { marginBottom: spacing.sm }]}>Take a test</Text>
          <Text style={[type.body, { marginBottom: spacing.xl }]}>
            Scan the QR code from your invitation, or paste the test link below.
          </Text>

          <Button label="Scan QR code" onPress={() => router.push('/scan')} />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={type.caption}>or</Text>
            <View style={styles.divider} />
          </View>

          <Card style={{ padding: spacing.md }}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Paste test link or code"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={openTest}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Open test" variant="secondary" onPress={openTest} disabled={!input.trim()} />
          </Card>
        </View>

        <Text style={[type.caption, { textAlign: 'center', marginBottom: spacing.md }]}>
          This app only runs tests. Studies are created and analyzed on the web dashboard.
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  brandName: { fontSize: 17, fontWeight: '700', color: colors.ink },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.line },
  input: {
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
});
