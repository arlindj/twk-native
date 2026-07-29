import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { radius, spacing, type, useTheme } from '../theme';

/**
 * The app detected the goal screen itself — this offers the single next
 * step instead of a manual "I completed the task" confirmation.
 */
export function GoalReachedModal({
  taskIndex,
  taskTitle,
  isLastTask,
  onContinue,
}: {
  taskIndex: number;
  taskTitle: string;
  isLastTask: boolean;
  onContinue: () => void;
}) {
  const { colors, resolvedMode } = useTheme();
  return (
    <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.line },
          resolvedMode === 'light' && styles.cardShadow,
        ]}
      >
        <View style={[styles.check, { backgroundColor: colors.brand }]}>
          <Text style={[styles.checkMark, { color: colors.onBrand }]}>✓</Text>
        </View>
        <Text style={[styles.kicker, { color: colors.brand }]}>Task {taskIndex + 1} complete</Text>
        <Text style={[styles.title, { color: colors.ink }]}>{taskTitle}</Text>
        <Text style={[styles.sub, { color: colors.ink3 }]}>
          Nice work. The app spotted you reached the goal.
        </Text>
        <View style={{ alignSelf: 'stretch', marginTop: spacing.sm }}>
          <Button label={isLastTask ? 'Finish test' : 'Continue to next task'} onPress={onContinue} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl * 1.5,
    gap: spacing.md,
  },
  cardShadow: {
    shadowColor: '#0F1729',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  check: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 34, fontWeight: '800' },
  kicker: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: { ...type.h2, textAlign: 'center' },
  sub: { ...type.caption, textAlign: 'center' },
});
