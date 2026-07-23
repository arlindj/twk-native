import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing, useTheme } from '../../theme';

/** Hairline separator for flat list rows. */
export function Divider({ inset = false }: { inset?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.line, { backgroundColor: colors.line }, inset && { marginLeft: spacing.md }]}
    />
  );
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
  },
});
