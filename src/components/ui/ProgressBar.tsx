import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, useTheme } from '../../theme';

/** Thin step-progress bar; the accent fill is the only colored element. */
export function ProgressBar({ progress }: { progress: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.line }]}>
      <View
        style={[
          styles.fill,
          { backgroundColor: colors.brand, width: `${Math.min(100, Math.max(0, progress * 100))}%` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    borderRadius: radius.pill,
  },
});
