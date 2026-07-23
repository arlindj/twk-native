import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

import { radius, spacing, useTheme } from '../../theme';

/**
 * Callout block: monochrome line icon on the left, soft tinted background,
 * no border — mirrors the web app's soft alert/tint patterns (bg-brand-50,
 * bg-danger-soft, bg-warn-soft). `tone` switches background + icon color.
 */
export function Callout({
  icon,
  children,
  tone = 'default',
  style,
}: {
  /** Feather icon name, e.g. "info", "alert-triangle". */
  icon: string;
  children: React.ReactNode;
  tone?: 'default' | 'brand' | 'danger' | 'warning';
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const bg =
    tone === 'brand'
      ? colors.brand50
      : tone === 'danger'
        ? colors.dangerSoft
        : tone === 'warning'
          ? colors.warnSoft
          : colors.surface50;
  const fg =
    tone === 'brand'
      ? colors.brand700
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warn
          : colors.ink3;
  return (
    <View style={[styles.callout, { backgroundColor: bg }, style]}>
      <Feather name={icon} size={18} color={fg} style={styles.icon} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  callout: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  icon: { marginTop: 2 },
});
