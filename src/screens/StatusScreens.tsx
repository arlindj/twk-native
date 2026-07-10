import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Screen } from '../components/ui';
import { resetToHome } from '../navigation';
import { useSession } from '../state/sessionStore';
import { colors, spacing, type } from '../theme';

export function ResolvingScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={type.body}>Preparing your test…</Text>
      </View>
    </Screen>
  );
}

export function LinkErrorScreen() {
  const error = useSession((s) => s.error);
  const reset = useSession((s) => s.reset);
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={[type.h2, { marginBottom: spacing.sm }]}>This test can’t be opened</Text>
        <Text style={[type.body, { marginBottom: spacing.lg }]}>{error}</Text>
        <Button
          label="Back to home"
          onPress={() => {
            reset();
            resetToHome();
          }}
        />
      </View>
    </Screen>
  );
}

export function IncompatibleScreen() {
  const reset = useSession((s) => s.reset);
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={[type.h2, { marginBottom: spacing.sm }]}>Not a mobile test</Text>
        <Text style={[type.body, { marginBottom: spacing.lg }]}>
          This study was built for desktop and can’t run in the mobile app. Please open the test
          link on a computer instead.
        </Text>
        <Button
          label="Back to home"
          onPress={() => {
            reset();
            resetToHome();
          }}
        />
      </View>
    </Screen>
  );
}
