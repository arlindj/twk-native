import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../theme';

/** Small tag-style label. */
export function Pill({ label, tone = 'brand' }: { label: string; tone?: 'brand' | 'danger' | 'muted' }) {
  const bg = tone === 'brand' ? colors.brandLight : tone === 'danger' ? colors.dangerBg : colors.surface;
  const fg = tone === 'brand' ? colors.brandDark : tone === 'danger' ? colors.danger : colors.inkMuted;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
