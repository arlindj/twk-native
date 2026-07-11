import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { parseTestLink } from '../linkParser';
import { Nav } from '../navigation';
import { colors, radius, spacing, type } from '../theme';

/**
 * Welcome — the app is a participant runtime, so the only actions are
 * "open a test": scan the QR from the web dashboard, or paste the test
 * link / code manually. (Deep links skip this screen entirely.)
 *
 * Layout follows the common welcome pattern (hero → headline → actions →
 * legal footer) in a restrained visual language: a single calm brand
 * mark, bold two-line headline, muted subtitle.
 */
export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openTest = () => {
    const parsed = parseTestLink(input);
    if (!parsed) {
      setError('That does not look like a valid test link or code.');
      return;
    }
    setError(null);
    navigation.navigate('TestRunner', {
      token: parsed.token,
      ...(parsed.apiOverride ? { api: parsed.apiOverride } : {}),
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
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

        {/* Hero: calm concentric rings behind a single device mark. */}
        <View style={styles.hero}>
          <View style={[styles.ring, styles.ringOuter]} />
          <View style={[styles.ring, styles.ringInner]} />
          <View style={styles.heroMark}>
            <Feather name="smartphone" size={40} color={colors.brand} />
          </View>
        </View>

        <View style={styles.copy}>
          <Text style={styles.headline}>Your test.{'\n'}Your screen.</Text>
          <Text style={[type.body, styles.subtitle]}>
            Scan the QR code from your invitation, or paste your test link to begin.
          </Text>
        </View>

        <View style={styles.actions}>
          {manual ? (
            <>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Paste test link or code"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onSubmitEditing={openTest}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button label="Open test" onPress={openTest} disabled={!input.trim()} />
              <Button label="Back" variant="ghost" onPress={() => setManual(false)} />
            </>
          ) : (
            <>
              <Button label="Scan QR code" onPress={() => navigation.navigate('Scan')} />
              <Button label="Enter link manually" variant="secondary" onPress={() => setManual(true)} />
            </>
          )}
        </View>

        <Text style={styles.footer}>
          By continuing you agree that your screen and taps are recorded during the test.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  brandName: { fontSize: 16, fontWeight: '700', color: colors.ink },

  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  ring: {
    position: 'absolute',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ringOuter: { width: 240, height: 240 },
  ringInner: { width: 168, height: 168, borderColor: colors.brandMuted },
  heroMark: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: colors.brandLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  copy: { marginBottom: spacing.xl },
  headline: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  subtitle: { marginTop: spacing.sm },

  actions: { gap: 0 },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },

  footer: {
    ...type.caption,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
});
