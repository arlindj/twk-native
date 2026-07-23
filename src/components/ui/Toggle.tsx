import React from 'react';
import { Platform, Switch } from 'react-native';

import { useTheme } from '../../theme';

/**
 * Themed on/off switch. Thin wrapper over RN's native Switch so it keeps
 * the platform's accessibility + gesture behavior, tinted with the brand
 * green when on. The thumb stays white in both themes (it sits on either
 * the brand or the neutral track, both of which are dark enough).
 */
export function Toggle({
  value,
  onValueChange,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.line, true: colors.brand }}
      thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
      ios_backgroundColor={colors.line}
      style={{ opacity: disabled ? 0.4 : 1 }}
    />
  );
}
