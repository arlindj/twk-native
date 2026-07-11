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
import { Button, PageHeader, Pill } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { colors, radius, spacing, type } from '../theme';

/**
 * Guest intake — no login. Tester self-reports name, age, and role so the
 * web dashboard can attach results to user personas. Fields shown come from
 * bootstrap.intake (study-configurable).
 */
export function IntakeScreen() {
  const bootstrap = useSession((s) => s.bootstrap);
  const submitIntake = useSession((s) => s.submitIntake);
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
    <SafeAreaView style={styles.safe}>
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
          <Pill label={bootstrap.studyName} tone="muted" />
          <View style={{ marginTop: spacing.md }}>
            <PageHeader
              icon="user"
              title="About you"
              subtitle="No account needed. Tell us a bit about yourself so we can understand who took this test."
            />
          </View>

          <View style={{ gap: spacing.lg }}>
            {intake.askFullName ? (
              <Field label="Full name" required>
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="e.g. Sara Ahmed"
                  placeholderTextColor={colors.inkFaint}
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={styles.input}
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
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="number-pad"
                  style={styles.input}
                  returnKeyType="next"
                />
                {ageText.length > 0 && !ageOk ? (
                  <Text style={styles.hint}>Enter an age between 13 and 120.</Text>
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
                        style={[styles.chip, selected && styles.chipSelected]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            selected && { color: colors.brandDark, fontWeight: '700' },
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
                    style={[styles.chip, customRole && styles.chipSelected]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        customRole && { color: colors.brandDark, fontWeight: '700' },
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
                    placeholderTextColor={colors.inkFaint}
                    autoCapitalize="sentences"
                    style={[styles.input, { marginTop: spacing.sm }]}
                    returnKeyType="done"
                    onSubmitEditing={() => void onContinue()}
                  />
                ) : null}
              </Field>
            ) : null}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="Continue"
            loading={busy}
            disabled={!canContinue}
            onPress={() => void onContinue()}
          />
          <Text style={[type.caption, { textAlign: 'center', marginTop: spacing.sm }]}>
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
  // Small gray label above the input, not a bold heading.
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={{ color: colors.brand }}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.md },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  fieldLabel: { fontSize: 13, fontWeight: '500', color: colors.inkMuted },
  input: {
    // Soft gray fill, no border, generous padding.
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  hint: { ...type.caption, color: colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  chipText: { fontSize: 14, color: colors.inkMuted, fontWeight: '500' },
});
