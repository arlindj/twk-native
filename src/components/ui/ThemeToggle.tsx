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
        { backgroundColor: pressed ? colors.surface50 : 'transparent', borderColor: colors.line },
      ]}
    >
      <Feather name={isDark ? 'sun' : 'moon'} size={20} color={colors.ink2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
