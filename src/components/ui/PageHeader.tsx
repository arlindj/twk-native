import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

import { radius, spacing, type, useTheme } from '../../theme';
import { ThemeToggle } from './ThemeToggle';

/**
 * Page header: a monochrome line icon in a soft tinted tile above a
 * bold, left-aligned title — document layout, always top-aligned,
 * never a centered hero. The top row carries the back button (when
 * `onBack` is set) on the left and the dark/light toggle on the right,
 * so every pre/post-test screen offers it in the same place.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  onBack,
  showThemeToggle = true,
}: {
  /** Feather icon name, e.g. "video", "file-text". */
  icon: string;
  title: string;
  subtitle?: string;
  /** When provided, renders a back button above the header. */
  onBack?: () => void;
  /** Hide the theme toggle for this header (defaults to shown). */
  showThemeToggle?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      {onBack || showThemeToggle ? (
        <View style={styles.topRow}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ pressed }) => [
                styles.backTile,
                { borderColor: colors.line, backgroundColor: colors.card },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Feather name="chevron-left" size={22} color={colors.ink} />
            </Pressable>
          ) : (
            <View />
          )}
          {showThemeToggle ? <ThemeToggle /> : null}
        </View>
      ) : null}
      <View style={[styles.iconTile, { backgroundColor: colors.surface50 }]}>
        <Feather name={icon} size={26} color={colors.ink} />
      </View>
      <Text style={[type.h1, { color: colors.ink }]}>{title}</Text>
      {subtitle ? (
        <Text style={[type.body, { color: colors.ink3, marginTop: spacing.sm }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginLeft: -4,
  },
  backTile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
});
