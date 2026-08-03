import React, { useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from '../native/keepAwake';
import { FloatingTaskControl } from '../components/FloatingTaskControl';
import { TaskSheet } from '../components/TaskSheet';
import { GoalReachedModal } from '../components/GoalReachedModal';
import { track } from '../events/eventQueue';
import { matchesGoal, type TaskGoal } from '../lib/goalMatch';
import { useSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';
import { GraphHotspot, GraphScreen } from '../types';

/**
 * Native renderer for a confirmed clickable Figma graph — synth's web app
 * calls this the GraphPlayer (screens exported as images, hotspot rects
 * tapped to navigate). There is no URL to load (unlike figma_proto/live_url),
 * so this renders screens as full-bleed <Image>s with transparent touchable
 * overlays instead of a WebView, sharing PlayerScreen's task bar / sheet /
 * goal-confirmation UI and the same successScreenIds auto-complete pattern.
 *
 * Mounted with `key={currentTaskIndex}` by TestRunnerScreen — like the web
 * GraphPlayer's `key={current.id}`, each mission restarts navigation from
 * the study's single graph start screen (one shared graph, walked once per
 * mission), not from wherever the tester left off on the previous mission.
 */
export function GraphPlayerScreen() {
  useKeepAwake();
  const { colors } = useTheme();
  const bootstrap = useSession((s) => s.bootstrap);
  const index = useSession((s) => s.currentTaskIndex);
  const completeTask = useSession((s) => s.completeTask);
  const { width: deviceWidth } = useWindowDimensions();
  // Sheet stays closed until FTC tap; remount per task still resets local state.
  // Keyed by `currentTaskIndex` in TestRunnerScreen.
  const [taskSheet, setTaskSheet] = useState(false);
  const [screenTapTick, setScreenTapTick] = useState(0);
  const [goalReached, setGoalReached] = useState(false);

  const graph = bootstrap?.prototype.graph;
  const screensByNode = useMemo(() => {
    const m = new Map<string, GraphScreen>();
    for (const s of graph?.screens ?? []) m.set(s.nodeId, s);
    return m;
  }, [graph]);
  const [currentNodeId, setCurrentNodeId] = useState<string>(graph?.startNodeId ?? '');
  const currentScreenIdRef = useRef<string>(currentNodeId);
  const autoCompletedRef = useRef(false);

  if (!bootstrap || !graph) return null;
  const task = bootstrap.tasks[index];
  if (!task) return null;
  const screen = screensByNode.get(currentNodeId);
  const hotspots: GraphHotspot[] = graph.hotspots.filter((h) => h.screenNodeId === currentNodeId);
  /**
   * One matcher for both authoring paths: a structured `config.goal`, or the
   * legacy `successScreenIds` lifted into screen matchers on the node id. A
   * graph screen's identity IS its node id, which maps onto the contract's
   * authored `name` field — so the shared matcher (and its entry-screen guard)
   * applies here unchanged instead of a bespoke `includes` check.
   */
  const goal: TaskGoal | null =
    task.goal ??
    ((task.successScreenIds?.length ?? 0) > 0
      ? {
          v: 1,
          label: task.successScreenIds![0]!,
          any: task.successScreenIds!.map((id) => ({ kind: 'screen' as const, name: id })),
          entryScreen: { path: '', hash: '', sig: '', name: graph.startNodeId },
        }
      : null);
  const hasGoal = !!goal;

  const layoutWidth = deviceWidth;
  const layoutHeight = screen && screen.width > 0 ? layoutWidth * (screen.height / screen.width) : 0;
  const scale = screen && screen.width > 0 ? layoutWidth / screen.width : 1;

  const onScreenChange = (nodeId: string) => {
    if (!nodeId || nodeId === currentScreenIdRef.current) return;
    currentScreenIdRef.current = nodeId;
    setCurrentNodeId(nodeId);
    track('prototype_navigation', {
      taskId: task.id,
      meta: { prototypeScreenId: nodeId, source: 'graph', missionIndex: index },
    });
    const hit =
      goal &&
      matchesGoal(goal, {
        type: 'synth-signal',
        v: 1,
        kind: 'screen',
        screen: { path: '', hash: '', sig: '', name: nodeId },
        ts: Date.now(),
      });
    if (hit && !autoCompletedRef.current) {
      autoCompletedRef.current = true;
      track('task_goal_reached', { taskId: task.id, meta: { prototypeScreenId: nodeId, source: 'graph' } });
      // Goal detected by the app — the modal offers the next step instead of
      // a manual "I completed the task".
      setGoalReached(true);
    }
  };

  const onTapHotspot = (h: GraphHotspot) => {
    track('tap', {
      taskId: task.id,
      normalizedX: screen ? Number(((h.x + h.w / 2) / screen.width).toFixed(4)) : undefined,
      normalizedY: screen ? Number(((h.y + h.h / 2) / screen.height).toFixed(4)) : undefined,
      screenWidth: screen?.width,
      screenHeight: screen?.height,
      meta: { source: 'graph', prototypeScreenId: currentNodeId, interactive: true, missionIndex: index },
    });
    if (h.destinationNodeId) onScreenChange(h.destinationNodeId);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]} edges={['top', 'bottom']}>
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => {
          setScreenTapTick((t) => t + 1);
          return false;
        }}
      >
        {screen?.imageUrl ? (
          <View style={{ width: layoutWidth, height: layoutHeight }}>
            <Image
              source={{ uri: screen.imageUrl }}
              style={{ width: layoutWidth, height: layoutHeight }}
              resizeMode="contain"
            />
            {hotspots.map((h, i) => (
              <Pressable
                key={`${currentNodeId}_${i}`}
                onPress={() => onTapHotspot(h)}
                style={{
                  position: 'absolute',
                  left: h.x * scale,
                  top: h.y * scale,
                  width: Math.max(1, h.w * scale),
                  height: Math.max(1, h.h * scale),
                }}
              />
            ))}
          </View>
        ) : (
          <View style={[styles.errorBox, { backgroundColor: colors.paper }]}>
            <Text style={[type.body, { color: colors.ink3 }]}>This screen isn’t available.</Text>
          </View>
        )}
      </View>

      <FloatingTaskControl
        taskIndex={index}
        taskTotal={bootstrap.tasks.length}
        taskTitle={task.title}
        onPress={() => setTaskSheet(true)}
        active
        screenTapTick={screenTapTick}
        sheetOpen={taskSheet}
      />

      <TaskSheet
        visible={taskSheet}
        taskIndex={index}
        title={task.title}
        instruction={task.instruction}
        hasGoal={hasGoal}
        onGiveUp={() => {
          setTaskSheet(false);
          completeTask('abandoned');
        }}
        onDismiss={() => setTaskSheet(false)}
      />

      {goalReached ? (
        <GoalReachedModal
          taskIndex={index}
          taskTitle={task.title}
          isLastTask={index === bootstrap.tasks.length - 1}
          onContinue={() => void completeTask('completed')}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
});
