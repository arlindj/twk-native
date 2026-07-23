import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

import { radius, spacing, type, useTheme } from '../../theme';
import { GradientTile } from './GradientTile';
import { Pill } from './Pill';
import { ThemeToggle } from './ThemeToggle';

/**
 * Page header: a monochrome line icon in a soft tinted tile above a
 * bold, left-aligned title — document layout, always top-aligned,
 * never a centered hero. The top row carries the back button (when
 * `onBack` is set) on the left, the study name pill (when `studyName`
 * is set) centered between the two side controls, and the dark/light
 * toggle on the right — so every pre/post-test screen offers all three
 * in the same row instead of stacking them.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  onBack,
  studyName,
  showThemeToggle = true,
}: {
  /** Feather icon name, e.g. "video", "file-text". */
  icon: string;
  title: string;
  subtitle?: string;
  /** When provided, renders a back button above the header. */
  onBack?: () => void;
  /** When provided, renders a muted pill centered in the top row. */
  studyName?: string;
  /** Hide the theme toggle for this header (defaults to shown). */
  showThemeToggle?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      {onBack || showThemeToggle || studyName ? (
        <View style={styles.topRow}>
          <View style={styles.sideSlot}>
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
            ) : null}
          </View>
          <View style={styles.centerSlot}>
            {studyName ? <Pill label={studyName} tone="muted" /> : null}
          </View>
          <View style={[styles.sideSlot, styles.sideSlotEnd]}>
            {showThemeToggle ? <ThemeToggle /> : null}
          </View>
        </View>
      ) : null}
      <GradientTile size={48} radius={radius.lg} style={styles.iconTile}>
        <Feather name={icon} size={26} color={colors.brand700} />
      </GradientTile>
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
    marginBottom: spacing.md,
    marginLeft: -4,
  },
  // Fixed-width end slots (matching the 40x40 back/theme tiles) so the
  // center pill lands in the true middle whichever side controls are shown.
  sideSlot: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideSlotEnd: {
    alignItems: 'flex-end',
  },
  centerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: spacing.md,
  },
});
