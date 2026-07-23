import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { Button, Callout, ProgressBar, Screen, SectionLabel } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { radius, spacing, type, useTheme } from '../theme';

/**
 * One task at a time: progress bar, short instruction, single CTA.
 * The participant never sees the whole task list. Recording (if enabled)
 * starts when they tap "Start task" on task 1.
 */
export function TaskIntroScreen() {
  const { colors } = useTheme();
  const bootstrap = useSession((s) => s.bootstrap);
  const index = useSession((s) => s.currentTaskIndex);
  const beginTask = useSession((s) => s.beginTask);
  const taskBusy = useSession((s) => s.taskBusy);
  const recordingEnabled = useSession((s) => s.recordingEnabled);
  if (!bootstrap) return null;

  const task = bootstrap.tasks[index];
  if (!task) return null;
  const total = bootstrap.tasks.length;
  const startsRecording = recordingEnabled && index === 0;

  return (
    <Screen footer={<Button label="Start task" loading={taskBusy} onPress={() => void beginTask()} />}>
      <ProgressBar progress={index / total} />
      <View style={{ marginTop: spacing.xl }}>
        <SectionLabel>{`Task ${index + 1} of ${total}`}</SectionLabel>
        <View style={[styles.iconTile, { backgroundColor: colors.surface50 }]}>
          <Feather name="target" size={26} color={colors.ink} />
        </View>
        <Text style={[type.h1, { color: colors.ink }]}>{task.title}</Text>
        <Callout icon="flag" style={{ marginTop: spacing.lg }}>
          <Text style={[type.h3, { color: colors.ink }]}>Your task</Text>
          <Text style={[type.body, { color: colors.ink3, marginTop: 2 }]}>{task.instruction}</Text>
        </Callout>
        <Callout icon={startsRecording ? 'video' : 'info'} style={{ marginTop: spacing.sm }}>
          <Text style={[type.caption, { color: colors.ink3 }]}>
            {startsRecording
              ? 'Recording starts when you tap “Start task” — the system will ask for your permission first.'
              : 'When you’re done (or can’t continue), use the bar at the bottom of the screen.'}
          </Text>
        </Callout>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.sm,
  },
});
