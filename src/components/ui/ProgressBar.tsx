import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';

/**
 * Step-progress bar; the accent fill is the only colored element.
 * `height` defaults to a thin 3px (the step indicators atop
 * TaskIntroScreen/QuestionsScreen) — pass a taller value where the bar
 * itself is the thing being watched (e.g. an upload's byte progress),
 * so it reads as the primary indicator rather than decoration.
 */
export function ProgressBar({ progress, height = 3 }: { progress: number; height?: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.line, height, borderRadius: height / 2 }]}>
      <View
        style={[
          styles.fill,
          {
            backgroundColor: colors.brand,
            width: `${Math.min(100, Math.max(0, progress * 100))}%`,
            height,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
  },
  fill: {},
});
