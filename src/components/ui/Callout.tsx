import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

import { radius, spacing, useTheme, withAlpha } from '../../theme';

/**
 * Callout block: monochrome line icon on the left, soft tinted background
 * WITH a matching border — mirrors the web app's AlertBox exactly (every
 * variant there — info/success/warn/danger — pairs its soft bg with a
 * tinted border: `border-brand-100 bg-brand-50`, `border-danger/30
 * bg-danger-soft`, etc). The neutral `default` tone instead follows
 * DESIGN-TOKENS' "recessed well" pattern (`border-line bg-surface-50`).
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
  const border =
    tone === 'brand'
      ? colors.brand100
      : tone === 'danger'
        ? withAlpha(colors.danger, 0.3)
        : tone === 'warning'
          ? withAlpha(colors.warn, 0.3)
          : colors.line;
  const fg =
    tone === 'brand'
      ? colors.brand500
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warn
          : colors.ink3;
  return (
    <View style={[styles.callout, { backgroundColor: bg, borderColor: border }, style]}>
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
    borderWidth: 1,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  icon: { marginTop: 2 },
});
