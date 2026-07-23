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
import { Button, GradientTile, ThemeToggle } from '../components/ui';
import { parseTestLink } from '../linkParser';
import { Nav } from '../navigation';
import { inputChrome, radius, spacing, type, useTheme } from '../theme';

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
  const { colors, resolvedMode } = useTheme();
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  // The hero illustration stays put when switching to manual entry, and
  // only gets out of the way once the participant actually taps the field
  // and the keyboard opens — otherwise it overlaps the keyboard/content.
  const hideHero = manual && inputFocused;

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
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.brandRow}>
          <View style={[styles.logo, { backgroundColor: colors.brand }]}>
            <Text style={[styles.logoText, { color: colors.onBrand }]}>T</Text>
          </View>
          <Text style={[styles.brandName, { color: colors.ink }]}>TWK Participate</Text>
          <View style={{ flex: 1 }} />
          <ThemeToggle />
        </View>

        {/* Hero: calm concentric rings behind a single mark — the mark and
            copy change with the mode (scan-or-link vs link-only). Hidden
            while the manual-entry field is focused so it never overlaps
            the keyboard or the input on smaller screens — but the flex:1
            spacer stays either way, so the headline never jumps up against
            the brand row when the rings disappear. */}
        {!hideHero ? (
          <View style={styles.hero}>
            <View style={[styles.ring, styles.ringOuter, { borderColor: colors.line }]} />
            <View style={[styles.ring, styles.ringInner, { borderColor: colors.brand300 }]} />
            <GradientTile size={96} radius={28}>
              <Feather name={manual ? 'link' : 'smartphone'} size={40} color={colors.brand700} />
            </GradientTile>
          </View>
        ) : (
          <View style={styles.hero} />
        )}

        <View style={styles.copy}>
          {manual ? (
            <>
              <Text style={[styles.headline, { color: colors.ink }]}>Enter your{'\n'}test link.</Text>
              <Text style={[type.body, styles.subtitle, { color: colors.ink3 }]}>
                Paste the test link or code from your invitation.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.headline, { color: colors.ink }]}>Your test.{'\n'}Your screen.</Text>
              <Text style={[type.body, styles.subtitle, { color: colors.ink3 }]}>
                Scan the QR code from your invitation, or paste your test link to begin.
              </Text>
            </>
          )}
        </View>

        <View style={styles.actions}>
          {manual ? (
            <>
              <TextInput
                style={[styles.input, inputChrome(colors, resolvedMode)]}
                value={input}
                onChangeText={setInput}
                placeholder="Paste test link or code"
                placeholderTextColor={colors.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onSubmitEditing={openTest}
              />
              {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
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

        <Text style={[styles.footer, { color: colors.ink4 }]}>
          By continuing you agree that your screen and taps are recorded during the test.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: spacing.lg },
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 18, fontWeight: '800' },
  brandName: { fontSize: 16, fontWeight: '700' },

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
  },
  ringOuter: { width: 240, height: 240 },
  ringInner: { width: 168, height: 168 },

  copy: { marginBottom: spacing.xl },
  headline: {
    fontSize: 32,
    fontWeight: '800',
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
  },
  error: { fontSize: 13, marginTop: spacing.sm },

  footer: {
    ...type.caption,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
});
