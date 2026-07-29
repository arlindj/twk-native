import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutAnimation,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiquidGlassView } from './LiquidGlassView';
import { radius, spacing } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Collapses to a small dot after this long without interaction. */
const IDLE_COLLAPSE_MS = 3500;
/** A drag shorter than this (px) at release is treated as a tap, not a pan. */
const TAP_SLOP = 6;
const COLLAPSED_SIZE = 44;
/**
 * Extra clearance below the safe area's top inset. `insets.top` alone only
 * clears the status bar rectangle — on notch/Dynamic-Island devices the
 * clock/battery cluster still visually sits right at that line, so the
 * control needs real breathing room below it, not just past it (reported
 * twice: sat "very close to the clock" even after the first bump).
 */
const SAFE_TOP_GAP = spacing.xxl + spacing.md;
/**
 * Fixed dark scrim under the icon/label, on top of the glass/blur. The glass
 * is translucent by design, so its apparent color is whatever prototype
 * content sits behind it — a white icon over a light prototype screen (a
 * plain white app background, a light hero image) reads as invisible.
 * `UIGlassEffect` gives automatic legibility to *native* content added to its
 * own vibrancy-aware content view, but the icon/label here are RN views
 * layered as siblings, not reparented into that native hierarchy — so they
 * get none of that. A flat, fairly opaque scrim sidesteps the whole problem:
 * it darkens the same patch of backdrop regardless of what's under it, so
 * white content on top stays readable against literally any color. Still
 * glass at the edges (the scrim doesn't fill the whole bubble radius
 * inset), just not through the dead center where the icon/label sit.
 */
const SCRIM_COLOR = 'rgba(10, 12, 16, 0.55)';

/**
 * Floating task control — replaces the old full-width bottom bar.
 *
 * That bar was opaque, fixed at the bottom, and full-width: exactly the
 * screen region most prototypes reserve for their own primary actions (a
 * booking CTA, a tab bar), so it permanently blocked whatever the prototype
 * put there. This is the opposite shape on every axis that mattered:
 *
 *  - **Small.** A 44pt dot by default, not a full-width bar — it can only
 *    ever cover a small, moveable patch of the screen.
 *  - **Top, not bottom.** Mobile UI conventions put primary actions in the
 *    thumb zone at the bottom; anchoring here at the top avoids that zone
 *    entirely by default.
 *  - **Draggable.** For the cases neither of the above fully solves (a
 *    prototype with its own top-right menu button, say), the participant can
 *    drag it anywhere.
 *  - **Self-collapsing.** After a few seconds of not being touched it shrinks
 *    to a plain dot; any tap re-expands it. It never fully disappears —
 *    something a participant can't find again is worse than something
 *    slightly in the way.
 *  - **Glass, not a solid fill.** Backed by Apple's real Liquid Glass
 *    material on iOS 26+ (`UIGlassEffect`, falling back to a system blur
 *    below that), Android's hardware blur where the OS supports it, so
 *    prototype content stays legible through it instead of
 *    being replaced by a flat black pill.
 *
 * One tap always does the same thing regardless of collapsed/expanded state:
 * expand (if needed) and open the task sheet. The collapse is purely a
 * space-saving idle state, not a separate "peek" step.
 */
export function FloatingTaskControl({
  taskTitle,
  onPress,
  active,
}: {
  taskTitle: string;
  onPress: () => void;
  /** Mirrors PlayerScreen's preload gating — hidden while inactive. */
  active: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(true);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;
  // Cumulative position across drags. Animated.ValueXY exposes no public,
  // typed way to read its current value back out (the docs' own recipe
  // reaches into the private `_value` field) — tracking it ourselves avoids
  // that and stays exact regardless of how many drags have happened.
  const basePosition = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Accessibility: a participant who turned on Reduce Transparency has
    // asked for a solid background instead of a live glass/blur effect.
    // iOS's real UIGlassEffect (and the pre-26 blur fallback) honors this
    // itself; Android has no equivalent OS setting to query, so this state
    // drives a manual `androidOverlayColor` fallback instead.
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then(setReduceTransparency)
      .catch(() => undefined);
  }, []);

  // Re-expand (and re-read) the moment this task actually becomes active.
  // The component is mounted unconditionally by the parent screen from
  // `task_intro` onward — long before `active` turns true — so without this
  // the idle-collapse timer below would already be counting down (or have
  // fired) against a control the participant can't even see yet, and it
  // would land on the new task already collapsed instead of freshly opened.
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  // Auto-collapse after a pause. Restarts whenever `expanded` turns true —
  // i.e. every time the participant interacts with it — and only counts
  // down while actually visible.
  useEffect(() => {
    if (!active || !expanded) return;
    const timer = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded(false);
    }, IDLE_COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [active, expanded]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_evt, gesture) => {
        pan.setValue({
          x: basePosition.current.x + gesture.dx,
          y: basePosition.current.y + gesture.dy,
        });
      },
      onPanResponderRelease: (_evt, gesture) => {
        // Distance comes from the release gesture's own totals, not a
        // separate accumulator built up across onPanResponderMove calls — a
        // fast/synthetic drag (seen from automated UI testing, and possibly
        // some real fling gestures) can deliver a grant and a release with
        // no move events in between, which would leave a move-only
        // accumulator at zero and misread a genuine drag as a tap.
        const distance = Math.hypot(gesture.dx, gesture.dy);
        if (distance < TAP_SLOP) {
          // A tap, not a drag — treat it as a press. Nothing to snap back:
          // with no meaningful movement, `pan` is already wherever it was.
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded(true);
          onPress();
          return;
        }
        basePosition.current = {
          x: basePosition.current.x + gesture.dx,
          y: basePosition.current.y + gesture.dy,
        };
        pan.setValue(basePosition.current);
      },
    }),
  ).current;

  if (!active) return null;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.anchor,
        {
          // The literal top-right corner is iOS's Control Center swipe-down
          // hot zone (confirmed by testing: a drag starting there opened
          // Control Center instead of moving this control, and even plain
          // taps landed unreliably) — pushed well clear of both the status
          // bar and that corner, not just past the safe-area line.
          top: insets.top + SAFE_TOP_GAP,
          right: spacing.lg,
          transform: pan.getTranslateTransform(),
        },
      ]}
      // The PanResponder above is the real touch handler — it disambiguates
      // a tap from a drag itself (see onPanResponderRelease), so there is no
      // separate Pressable nested inside. Two touch handlers stacked on the
      // same view is how a tap silently fires twice, or not at all, when the
      // parent claims the responder first.
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Task: ${taskTitle}. Tap to open, drag to move.`}
    >
      <View style={[styles.bubble, expanded ? styles.bubbleExpanded : styles.bubbleCollapsed]}>
        <LiquidGlassView
          style={StyleSheet.absoluteFill}
          interactive
          reduceTransparencyFallbackColor="#1A1A1A"
          // Android has no user-facing "Reduce Transparency" toggle to query,
          // so this mirrors the iOS fallback manually (checked once above)
          // instead of leaving Android as always-blur regardless of the
          // participant's setting. iOS's real UIGlassEffect honors Reduce
          // Transparency itself, so no equivalent check is needed there.
          androidOverlayColor={reduceTransparency ? '#1A1A1A' : 'transparent'}
        />
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.content}>
          <Feather name="clipboard" size={16} color="#fff" style={styles.icon} />
          {expanded ? (
            <Text numberOfLines={1} style={styles.label}>
              {taskTitle}
            </Text>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
  },
  bubble: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    // A hairline highlight, not a hard outline — gives the bubble a visible
    // edge against a same-tone backdrop (a white icon on a bright prototype
    // screen has no shadow to rely on there) without looking like a solid
    // chip. Same trick real Liquid Glass uses at its own edges.
    borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bubbleCollapsed: {
    width: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
  },
  bubbleExpanded: {
    height: COLLAPSED_SIZE,
    maxWidth: 220,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: SCRIM_COLOR },
  icon: { opacity: 0.95 },
  label: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
});
