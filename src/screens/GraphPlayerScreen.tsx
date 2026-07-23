import React, { useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from '../native/keepAwake';
import { Button } from '../components/ui';
import { track } from '../events/eventQueue';
import { useSession } from '../state/sessionStore';
import { radius, spacing, type, useTheme } from '../theme';
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
  const [taskSheet, setTaskSheet] = useState(false);
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
  const hasGoal = (task.successScreenIds?.length ?? 0) > 0;

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
    const goals = task.successScreenIds ?? [];
    if (!autoCompletedRef.current && goals.includes(nodeId)) {
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
      <View style={{ flex: 1 }}>
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

      {/* Floating task bar — always dark chrome regardless of theme, mirrors
          PlayerScreen (see its comment: overlays arbitrary screenshot content). */}
      <View style={styles.bar}>
        <Pressable style={styles.barTask} onPress={() => setTaskSheet(true)}>
          <View style={styles.barDot} />
          <Text numberOfLines={1} style={styles.barText}>
            {task.title}
          </Text>
        </Pressable>
        <Pressable style={[styles.barDone, { backgroundColor: colors.brand }]} onPress={() => setTaskSheet(true)}>
          <Text style={styles.barDoneText}>{hasGoal ? 'Stuck?' : 'Done?'}</Text>
        </Pressable>
      </View>

      <Modal visible={taskSheet} transparent animationType="slide" onRequestClose={() => setTaskSheet(false)}>
        <Pressable style={[styles.sheetBackdrop, { backgroundColor: colors.overlay }]} onPress={() => setTaskSheet(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
          <Text style={[type.h3, { color: colors.ink }]}>Task {index + 1}</Text>
          <Text style={[type.h2, { color: colors.ink, marginTop: 4 }]}>{task.title}</Text>
          <Text style={[type.body, { color: colors.ink3, marginTop: spacing.sm }]}>{task.instruction}</Text>
          <View style={{ marginTop: spacing.lg }}>
            {hasGoal ? (
              <Text style={[type.caption, { color: colors.ink3, marginBottom: spacing.md }]}>
                This task finishes on its own once you reach the goal. Only use the
                button below if you can’t get there.
              </Text>
            ) : (
              <Button
                label="I completed the task"
                onPress={() => {
                  setTaskSheet(false);
                  completeTask('completed');
                }}
              />
            )}
            <Button
              label="I give up"
              variant="danger"
              onPress={() => {
                setTaskSheet(false);
                completeTask('abandoned');
              }}
            />
            <Button label="Continue testing" variant="ghost" onPress={() => setTaskSheet(false)} />
          </View>
        </View>
      </Modal>

      {goalReached ? (
        <View style={[styles.goalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.goalCard, { backgroundColor: colors.card }]}>
            <View style={[styles.goalCheck, { backgroundColor: colors.brand }]}>
              <Text style={[styles.goalCheckMark, { color: colors.onBrand }]}>✓</Text>
            </View>
            <Text style={[styles.goalKicker, { color: colors.brand }]}>Task {index + 1} complete</Text>
            <Text style={[styles.goalTitle, { color: colors.ink }]}>{task.title}</Text>
            <Text style={[styles.goalSub, { color: colors.ink3 }]}>Nice work — the app spotted you reached the goal.</Text>
            <View style={{ alignSelf: 'stretch', marginTop: spacing.sm }}>
              <Button
                label={
                  index === bootstrap.tasks.length - 1 ? 'Finish test' : 'Continue to next task'
                }
                onPress={() => void completeTask('completed')}
              />
            </View>
          </View>
        </View>
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
  bar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  barTask: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF5A5A' },
  barText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  barDone: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  barDoneText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sheetBackdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
  goalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalCard: {
    alignItems: 'center',
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl * 1.5,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  goalCheck: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalCheckMark: { fontSize: 34, fontWeight: '800' },
  goalKicker: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalTitle: { ...type.h2, textAlign: 'center' },
  goalSub: { ...type.caption, textAlign: 'center' },
});
