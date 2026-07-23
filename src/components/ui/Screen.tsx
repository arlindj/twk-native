import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing, useTheme } from '../../theme';

/**
 * Screen scaffold — themed canvas, padded column, optional pinned
 * footer separated by a hairline.
 */
export function Screen({
  children,
  style,
  footer,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  footer?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <View style={[styles.screen, style]}>{children}</View>
      {footer ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: colors.paper, borderTopColor: colors.line },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
