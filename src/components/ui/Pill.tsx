import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, useTheme } from '../../theme';

/**
 * Small tag-style label — matches the web app's Badge (rounded-full, soft
 * tint). `truncate` clips to one line instead of hugging its content (for
 * placement in a fixed-width slot, e.g. centered in a header row); when the
 * label actually overflows, tapping it shows the full text.
 */
export function Pill({
  label,
  tone = 'brand',
  truncate = false,
}: {
  label: string;
  tone?: 'brand' | 'danger' | 'muted';
  truncate?: boolean;
}) {
  const { colors } = useTheme();
  const bg = tone === 'brand' ? colors.brand50 : tone === 'danger' ? colors.dangerSoft : colors.surface50;
  const fg = tone === 'brand' ? colors.brand700 : tone === 'danger' ? colors.danger : colors.ink3;
  const [overflowing, setOverflowing] = useState(false);

  const body = (
    <View style={[styles.pill, { backgroundColor: bg }, truncate && styles.pillTruncate]}>
      <Text
        style={{ color: fg, fontSize: 12, fontWeight: '600' }}
        numberOfLines={truncate ? 1 : undefined}
        onTextLayout={
          truncate ? (e) => setOverflowing(e.nativeEvent.lines.length > 1) : undefined
        }
      >
        {label}
      </Text>
    </View>
  );

  if (!truncate || !overflowing) return body;

  return (
    <Pressable
      onPress={() => Alert.alert(label)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // Caps the pill at the width its slot actually has, so a long label
  // clips to one line instead of pushing into the neighboring controls.
  pillTruncate: {
    alignSelf: 'auto',
    maxWidth: '100%',
  },
});
