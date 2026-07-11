import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Page header: a monochrome line icon in a soft gray tile above a
 * bold, left-aligned title — document layout, always top-aligned,
 * never a centered hero.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
}: {
  /** Feather icon name, e.g. "video", "file-text". */
  icon: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.wrap}>
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
