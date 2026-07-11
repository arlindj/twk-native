import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../../theme';

/** Hairline separator for flat list rows. */
export function Divider({ inset = false }: { inset?: boolean }) {
  return <View style={[styles.line, inset && { marginLeft: spacing.md }]} />;
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
});
