import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Page header: a monochrome line icon in a soft gray tile above a
 * bold, left-aligned title — document layout, always top-aligned,
 * never a centered hero. When `onBack` is set, a chevron tile sits
 * above the icon for stepping back to the previous screen.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  onBack,
}: {
  /** Feather icon name, e.g. "video", "file-text". */
  icon: string;
  title: string;
  subtitle?: string;
  /** When provided, renders a back button above the header. */
  onBack?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backTile, pressed && { opacity: 0.6 }]}
        >
          <Feather name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
      ) : null}
      <View style={styles.iconTile}>
        <Feather name={icon} size={26} color={colors.ink} />
      </View>
      <Text style={type.h1}>{title}</Text>
      {subtitle ? <Text style={[type.body, { marginTop: spacing.sm }]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  backTile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    marginLeft: -4,
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
});
