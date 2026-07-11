import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Primary uses our brand green; secondary is white with a hairline
 * border (auth-button style); ghost is text-only. Pressed state darkens.
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
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: pressed ? colors.brandDark : colors.brand },
        variant === 'secondary' && {
          backgroundColor: pressed ? colors.surface : colors.card,
          borderWidth: 1,
          borderColor: colors.line,
        },
        variant === 'ghost' && { backgroundColor: pressed ? colors.surface : 'transparent' },
        variant === 'danger' && { backgroundColor: colors.dangerBg },
        isDisabled && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.brand} />
      ) : (
        <Text
          style={[
            type.button,
            variant === 'primary' && { color: '#fff' },
            variant === 'secondary' && { color: colors.ink },
            variant === 'ghost' && { color: colors.inkMuted },
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
});
