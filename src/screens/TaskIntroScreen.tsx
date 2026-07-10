import React from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Pill, ProgressBar, Screen } from '../components/ui';
import { useSession } from '../state/sessionStore';
import { spacing, type } from '../theme';

/**
 * One task at a time, Maze-style: progress bar, short instruction,
 * single CTA. The participant never sees the whole task list.
 */
export function TaskIntroScreen() {
  const bootstrap = useSession((s) => s.bootstrap);
  const index = useSession((s) => s.currentTaskIndex);
  const beginTask = useSession((s) => s.beginTask);
  if (!bootstrap) return null;

  const task = bootstrap.tasks[index];
  const total = bootstrap.tasks.length;

  return (
    <Screen footer={<Button label="Start task" onPress={beginTask} />}>
      <ProgressBar progress={index / total} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Pill label={`Task ${index + 1} of ${total}`} />
        <Text style={[type.h1, { marginTop: spacing.md }]}>{task.title}</Text>
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={type.h3}>Your task</Text>
          <Text style={[type.body, { marginTop: spacing.xs }]}>{task.instruction}</Text>
        </Card>
        <Text style={[type.caption, { marginTop: spacing.md }]}>
          When you’re done (or can’t continue), use the bar at the bottom of the screen.
        </Text>
      </View>
    </Screen>
  );
}
