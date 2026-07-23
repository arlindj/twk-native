import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { radius, spacing, useTheme } from '../../theme';

/**
 * Raised surface — hairline border, web's rounded-xl radius, a subtle shadow
 * in light mode only (the web app's hard rule: no elevation shadows in dark
 * mode, since shadows don't read against dark backgrounds).
 */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors, resolvedMode } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.line },
        resolvedMode === 'light' && styles.shadow,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  shadow: {
    shadowColor: '#0F1729',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
});
