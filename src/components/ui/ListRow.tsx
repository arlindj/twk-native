import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

import { spacing, type, useTheme } from '../../theme';

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
  control,
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
  /** Trailing interactive control (e.g. a Toggle) — replaces value/chevron. */
  control?: React.ReactNode;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]}>
      <Feather name={icon} size={20} color={colors.ink3} style={styles.icon} />
      <View style={{ flex: 1 }}>
        <Text style={[type.h3, { color: colors.ink }]}>{title}</Text>
        {body ? <Text style={[type.body, { color: colors.ink3, marginTop: 2 }]}>{body}</Text> : null}
      </View>
      {control ?? (
        <>
          {value ? <Text style={[styles.value, { color: colors.ink4 }]}>{value}</Text> : null}
          {chevron ? <Feather name="chevron-right" size={18} color={colors.ink4} /> : null}
        </>
      )}
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
  icon: { marginTop: 1, alignSelf: 'flex-start' },
  value: { fontSize: 14 },
});
