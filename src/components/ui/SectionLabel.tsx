import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../theme';

/**
 * Muted grouping label (e.g. "WHAT WE COLLECT"): small, uppercase,
 * gray, slight letter-spacing.
 */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: colors.inkFaint,
    marginBottom: spacing.sm,
  },
});
