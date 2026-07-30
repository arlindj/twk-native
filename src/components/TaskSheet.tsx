import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { radius, spacing, type, useTheme } from '../theme';

/**
 * The task sheet, opened by tapping `FloatingTaskControl`.
 *
 * HTML / live_url prototypes require an explicit "I completed this task"
 * tap (same as the web participant flow) — goal screens are not reliable
 * enough to auto-finish. Figma prototypes omit that button: the app
 * detects the goal screen itself and shows `GoalReachedModal` (see
 * PlayerScreen / GraphPlayerScreen's onScreenChange).
 */
export function TaskSheet({
  visible,
  taskIndex,
  title,
  instruction,
  hasGoal,
  onComplete,
  onGiveUp,
  onDismiss,
}: {
  visible: boolean;
  taskIndex: number;
  title: string;
  instruction: string;
  /** False for a task with no configured goal screen — Figma auto-finish path. */
  hasGoal: boolean;
  /**
   * When set (HTML / live_url prototypes), shows the primary complete
   * action. Omit for Figma so success comes only from goal detection.
   */
  onComplete?: () => void;
  onGiveUp: () => void;
  onDismiss: () => void;
}) {
  const { colors, resolvedMode } = useTheme();
  const manualComplete = typeof onComplete === 'function';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onDismiss} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.card, borderColor: colors.line },
          resolvedMode === 'light' && styles.sheetShadow,
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.line }]} />
        <Text style={[type.h3, { color: colors.ink }]}>Task {taskIndex + 1}</Text>
        <Text style={[type.h2, { color: colors.ink, marginTop: 4 }]}>{title}</Text>
        <Text style={[type.body, { color: colors.ink3, marginTop: spacing.sm }]}>{instruction}</Text>
        <View style={{ marginTop: spacing.lg }}>
          <Text style={[type.caption, { color: colors.ink3, marginBottom: spacing.md }]}>
            {manualComplete
              ? 'Mark the task complete when you’re finished, or give up if you can’t continue.'
              : hasGoal
                ? 'This task finishes on its own once you reach the goal.'
                : 'There is no automatic finish for this task. Use "I give up" if you can’t continue.'}
          </Text>
          {manualComplete ? (
            <Button label="I completed this task" variant="primary" onPress={onComplete} />
          ) : null}
          <Button label="I give up" variant="danger" onPress={onGiveUp} />
          <Button label="Continue testing" variant="ghost" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetShadow: {
    shadowColor: '#0F1729',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
});
