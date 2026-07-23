import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, PageHeader } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { inputChrome, radius, spacing, type, useTheme } from '../theme';

/**
 * Guest intake — no login. Tester self-reports name, age, and role so the
 * web dashboard can attach results to user personas. Fields shown come from
 * bootstrap.intake (study-configurable).
 */
export function IntakeScreen() {
  const { colors, resolvedMode } = useTheme();
  const bootstrap = useSession((s) => s.bootstrap);
  const submitIntake = useSession((s) => s.submitIntake);
  const back = useSession((s) => s.back);
  const intake = bootstrap?.intake;

  const [fullName, setFullName] = useState('');
  const [ageText, setAgeText] = useState('');
  const [role, setRole] = useState('');
  const [customRole, setCustomRole] = useState(false);
  const [busy, setBusy] = useState(false);

  const age = useMemo(() => {
    const n = Number.parseInt(ageText.trim(), 10);
    return Number.isFinite(n) ? n : undefined;
  }, [ageText]);

  if (!bootstrap || !intake) return null;

  const nameOk = !intake.askFullName || fullName.trim().length >= 2;
  const ageOk =
    !intake.askAge || (age != null && age >= 13 && age <= 120 && ageText.trim().length > 0);
  const roleValue = role.trim();
  const roleOk = !intake.askRole || roleValue.length >= 2;
  const canContinue = nameOk && ageOk && roleOk;

  const onContinue = async () => {
    if (!canContinue || busy) return;
    setBusy(true);
    try {
      await submitIntake({
        fullName: intake.askFullName ? fullName.trim() : undefined,
        age: intake.askAge ? age : undefined,
        role: intake.askRole ? roleValue : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          // Keeps the focused input above the keyboard; drag dismisses the
          // number-pad (which has no return key) so the role chips + footer
          // stay reachable.
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
        >
          <PageHeader
            icon="user"
            title="About you"
            subtitle="No account needed. Tell us a bit about yourself so we can understand who took this test."
            studyName={bootstrap.studyName}
            onBack={back}
          />

          <View style={{ gap: spacing.lg }}>
            {intake.askFullName ? (
              <Field label="Full name" required>
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="e.g. Sara Ahmed"
                  placeholderTextColor={colors.ink3}
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={[styles.input, inputChrome(colors, resolvedMode)]}
                  returnKeyType="next"
                />
              </Field>
            ) : null}

            {intake.askAge ? (
              <Field label="Age" required>
                <TextInput
                  value={ageText}
                  onChangeText={(t) => setAgeText(t.replace(/[^0-9]/g, '').slice(0, 3))}
                  placeholder="e.g. 28"
                  placeholderTextColor={colors.ink3}
                  keyboardType="number-pad"
                  style={[styles.input, inputChrome(colors, resolvedMode)]}
                  returnKeyType="next"
                />
                {ageText.length > 0 && !ageOk ? (
                  <Text style={[type.caption, { color: colors.danger }]}>
                    Enter an age between 13 and 120.
                  </Text>
                ) : null}
              </Field>
            ) : null}

            {intake.askRole ? (
              <Field label="Your role" required>
                <View style={styles.chips}>
                  {intake.roleOptions.map((option) => {
                    const selected = !customRole && role === option;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        onPress={() => {
                          setCustomRole(false);
                          setRole(option);
                        }}
                        style={[
                          styles.chip,
                          { borderColor: colors.line, backgroundColor: colors.card },
                          selected && { borderColor: colors.brand, backgroundColor: colors.brand50 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.ink3 },
                            selected && { color: colors.brand700, fontWeight: '700' },
                          ]}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setCustomRole(true);
                      setRole('');
                    }}
                    style={[
                      styles.chip,
                      { borderColor: colors.line, backgroundColor: colors.card },
                      customRole && { borderColor: colors.brand, backgroundColor: colors.brand50 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: colors.ink3 },
                        customRole && { color: colors.brand700, fontWeight: '700' },
                      ]}
                    >
                      Other
                    </Text>
                  </Pressable>
                </View>
                {customRole ? (
                  <TextInput
                    value={role}
                    onChangeText={setRole}
                    placeholder="Type your role"
                    placeholderTextColor={colors.ink3}
                    autoCapitalize="sentences"
                    style={[
                      styles.input,
                      inputChrome(colors, resolvedMode),
                      { marginTop: spacing.sm },
                    ]}
                    returnKeyType="done"
                    onSubmitEditing={() => void onContinue()}
                  />
                ) : null}
              </Field>
            ) : null}
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.line }]}>
          <Button
            label="Continue"
            loading={busy}
            disabled={!canContinue}
            onPress={() => void onContinue()}
          />
          <Text style={[type.caption, { color: colors.ink3, textAlign: 'center', marginTop: spacing.sm }]}>
            Guest session — you won’t need to sign in
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  // Small gray label above the input, not a bold heading.
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[styles.fieldLabel, { color: colors.ink3 }]}>
        {label}
        {required ? <Text style={{ color: colors.brand }}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.md },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { fontSize: 13, fontWeight: '500' },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipText: { fontSize: 14, fontWeight: '500' },
});
