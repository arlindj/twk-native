import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import { withAlpha, useTheme } from '../../theme';

/**
 * Soft brand-tinted icon tile — mirrors the web app's recurring accent tile
 * (sidebar/dashboard-card icons): `bg-gradient-to-br from-brand-500/20
 * to-brand-700/5 ring-1 ring-inset ring-brand/15`. A diagonal gradient (not a
 * flat fill) plus a faint brand ring is the actual web look for any icon
 * tile — used here in place of a plain surface-50 square.
 */
export function GradientTile({
  size,
  radius,
  children,
  style,
}: {
  size: number;
  radius: number;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <LinearGradient
      colors={[withAlpha(colors.brand500, 0.2), withAlpha(colors.brand700, 0.05)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: withAlpha(colors.brand, 0.15),
        },
        style,
      ]}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
