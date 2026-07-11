import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, type } from '../../theme';

/**
 * Flat list row: muted monochrome line icon, title + optional body,
 * optional trailing value + chevron, hairline divider underneath
 * (no card chrome).
 */
export function ListRow({
  icon,
  title,
  body,
  value,
  chevron = false,
  last = false,
}: {
  /** Feather icon name, e.g. "video", "smartphone". */
  icon: string;
  title: string;
  body?: string;
  /** Trailing gray value text. */
  value?: string;
  /** Show a trailing chevron. */
  chevron?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Feather name={icon} size={20} color={colors.inkMuted} style={styles.icon} />
      <View style={{ flex: 1 }}>
        <Text style={type.h3}>{title}</Text>
        {body ? <Text style={[type.body, { marginTop: 2 }]}>{body}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {chevron ? <Feather name="chevron-right" size={18} color={colors.inkFaint} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  icon: { marginTop: 1, alignSelf: 'flex-start' },
  value: { fontSize: 14, color: colors.inkFaint },
});
