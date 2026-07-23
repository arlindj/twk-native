import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius, useTheme } from '../../theme';

/** Small tag-style label — matches the web app's Badge (rounded-full, soft tint). */
export function Pill({ label, tone = 'brand' }: { label: string; tone?: 'brand' | 'danger' | 'muted' }) {
  const { colors } = useTheme();
  const bg = tone === 'brand' ? colors.brand50 : tone === 'danger' ? colors.dangerSoft : colors.surface50;
  const fg = tone === 'brand' ? colors.brand700 : tone === 'danger' ? colors.danger : colors.ink3;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
