import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { spacing, useTheme } from '../../theme';

/**
 * Muted grouping label (e.g. "WHAT WE COLLECT"): small, uppercase,
 * gray, slight letter-spacing.
 */
export function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.ink4 }]}>{children.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
});
