import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../../theme';

/** Thin step-progress bar; the accent fill is the only colored element. */
export function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, progress * 100))}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
});
