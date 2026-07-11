import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, radius, spacing } from '../../theme';

/**
 * Callout block: monochrome line icon on the left, soft gray
 * background, no border. `tone` switches background + icon color for
 * warnings/errors.
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
  const bg =
    tone === 'brand'
      ? colors.brandLight
      : tone === 'danger'
        ? colors.dangerBg
        : tone === 'warning'
          ? colors.warningBg
          : colors.surface;
  const fg =
    tone === 'brand'
      ? colors.brandDark
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warning
          : colors.inkMuted;
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
