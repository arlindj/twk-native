import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { radius, spacing, type, useTheme } from '../../theme';

/**
 * Primary uses the brand green (matches the web app's default Button);
 * secondary is an outlined button (web's `outline` variant); ghost is
 * text-only; danger is a soft, calm treatment (web's danger Badge tint,
 * not an alarming solid red — this is a "give up" action, not a destructive
 * one). Pressed state darkens/tints.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors, resolvedMode } = useTheme();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        // Web's primary button carries a subtle shadow (none in dark mode —
        // same rule as Card).
        variant === 'primary' && resolvedMode === 'light' && styles.primaryShadow,
        variant === 'primary' && { backgroundColor: pressed ? colors.brand700 : colors.brand },
        variant === 'secondary' && {
          backgroundColor: pressed ? colors.surface50 : colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.line,
        },
        variant === 'ghost' && { backgroundColor: pressed ? colors.surface50 : 'transparent' },
        variant === 'danger' && { backgroundColor: colors.dangerSoft },
        isDisabled && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onBrand : colors.brand} />
      ) : (
        <Text
          style={[
            type.button,
            variant === 'primary' && { color: colors.onBrand },
            variant === 'secondary' && { color: colors.ink },
            variant === 'ghost' && { color: colors.ink3 },
            variant === 'danger' && { color: colors.danger },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  primaryShadow: {
    shadowColor: '#0F1729',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
});
