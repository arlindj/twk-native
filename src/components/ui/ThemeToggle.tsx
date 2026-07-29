import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

import { useTheme } from '../../theme';

/**
 * Icon-only dark/light toggle — mirrors the web app's ThemeToggle (sun/moon
 * swap, same interaction). Sized as a comfortable touch target (40x40).
 */
export function ThemeToggle() {
  const { colors, resolvedMode, toggleTheme } = useTheme();
  const isDark = resolvedMode === 'dark';
  return (
    <Pressable
      onPress={toggleTheme}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: pressed ? colors.surface50 : 'transparent',
          borderColor: colors.lineStrong,
        },
      ]}
    >
      <Feather name={isDark ? 'sun' : 'moon'} size={20} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    // 1px, not the platform hairline — same reasoning as Button's secondary
    // outline: at hairline width the extra contrast still reads as faint.
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
