import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutAnimation,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiquidGlassView } from './LiquidGlassView';
import { clearStudyChromeRect, setStudyChromeRect } from '../lib/studyChrome';
import { radius, spacing } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Full "Task: …" label before auto-minimizing. */
const INTRO_MS = 2000;
const TAP_SLOP = 6;
const SCRIM_COLOR = 'rgba(10, 12, 16, 0.55)';
const EDGE_GAP = spacing.md;
/** Slightly above vertical centre of the safe content area. */
const ANCHOR_Y_RATIO = 0.42;
const EXPANDED_MIN_H = 40;
const MINIMIZED_W = 24;
const MINIMIZED_H = 44;
const SLOT_H = Math.max(EXPANDED_MIN_H, MINIMIZED_H);

function animateLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

function clampY(y: number, minY: number, maxY: number) {
  return Math.max(minY, Math.min(maxY, y));
}

type LifecycleApi = {
  clearIntroTimer: () => void;
  startIntro: () => void;
  onPillPress: () => void;
  onDragEnd: (y: number) => void;
};

/**
 * Sticky right-edge task pill — flush to the screen edge, rounded only on the
 * inward (left) side. Lives inside `SafeAreaView` with `edges={['top','bottom']}`.
 *
 * Intro (2s): "Task: {title}" → minimized vertical ⋮ (three dots).
 * Prototype tap toggles hidden ↔ minimized. Pill tap opens the sheet (stays minimized).
 */
export function FloatingTaskControl({
  taskIndex,
  taskTotal,
  taskTitle,
  onPress,
  active,
  screenTapTick = 0,
  sheetOpen = false,
}: {
  taskIndex: number;
  taskTotal: number;
  taskTitle: string;
  onPress: () => void;
  active: boolean;
  screenTapTick?: number;
  sheetOpen?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [intro, setIntro] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  const panY = useRef(new Animated.Value(0)).current;
  const baseYOffset = useRef(0);
  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const sheetOpenRef = useRef(sheetOpen);
  const activeRef = useRef(active);
  const hiddenRef = useRef(hidden);
  const anchorRef = useRef<View>(null);

  const publishChromeBounds = useCallback(() => {
    if (!activeRef.current || hiddenRef.current) {
      clearStudyChromeRect();
      return;
    }
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      if (!activeRef.current || hiddenRef.current || width <= 0 || height <= 0) {
        clearStudyChromeRect();
        return;
      }
      setStudyChromeRect({ x, y, width, height });
    });
  }, []);

  const contentHeight = windowHeight - insets.top - insets.bottom;
  const anchorTop = contentHeight * ANCHOR_Y_RATIO - SLOT_H / 2;
  const dragMinY = EDGE_GAP - anchorTop;
  const dragMaxY = contentHeight - EDGE_GAP - SLOT_H - anchorTop;

  const progress = `${taskIndex + 1}/${taskTotal}`;

  const lifecycleRef = useRef<LifecycleApi>({
    clearIntroTimer: () => undefined,
    startIntro: () => undefined,
    onPillPress: () => undefined,
    onDragEnd: () => undefined,
  });

  const clearIntroTimer = () => {
    if (introTimer.current) {
      clearTimeout(introTimer.current);
      introTimer.current = null;
    }
  };

  const finishIntro = () => {
    if (!activeRef.current) return;
    animateLayout();
    setIntro(false);
  };

  const startIntro = () => {
    if (!activeRef.current) return;
    clearIntroTimer();
    animateLayout();
    setIntro(true);
    setHidden(false);
    introTimer.current = setTimeout(() => finishIntro(), INTRO_MS);
  };

  const onPillPress = () => {
    clearIntroTimer();
    if (intro) {
      animateLayout();
      setIntro(false);
    }
    onPress();
  };

  const onDragEnd = (y: number) => {
    const clamped = clampY(y, dragMinY, dragMaxY);
    baseYOffset.current = clamped;
    panY.setValue(clamped);
    draggingRef.current = false;
    requestAnimationFrame(() => publishChromeBounds());
  };

  const toggleHiddenFromScreenTap = () => {
    if (intro) {
      clearIntroTimer();
      animateLayout();
      setIntro(false);
      setHidden(true);
      return;
    }
    animateLayout();
    if (hiddenRef.current) {
      setHidden(false);
    } else {
      setHidden(true);
    }
  };

  lifecycleRef.current = { clearIntroTimer, startIntro, onPillPress, onDragEnd };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 2,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        lifecycleRef.current.clearIntroTimer();
        if (intro) {
          animateLayout();
          setIntro(false);
        }
      },
      onPanResponderMove: (_evt, gesture) => {
        panY.setValue(clampY(baseYOffset.current + gesture.dy, dragMinY, dragMaxY));
      },
      onPanResponderRelease: (_evt, gesture) => {
        const distance = Math.hypot(gesture.dx, gesture.dy);
        if (distance < TAP_SLOP) {
          draggingRef.current = false;
          lifecycleRef.current.onPillPress();
          return;
        }
        lifecycleRef.current.onDragEnd(baseYOffset.current + gesture.dy);
      },
    }),
  ).current;

  sheetOpenRef.current = sheetOpen;
  activeRef.current = active;
  hiddenRef.current = hidden;

  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then(setReduceTransparency)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    clearIntroTimer();
    baseYOffset.current = 0;
    panY.setValue(0);
    if (!active) {
      setIntro(false);
      setHidden(false);
      return;
    }
    startIntro();
    return clearIntroTimer;
  }, [active]);

  useEffect(() => {
    if (!active || screenTapTick <= 0) return;
    toggleHiddenFromScreenTap();
  }, [active, screenTapTick]);

  useEffect(() => {
    if (!active || hidden) {
      clearStudyChromeRect();
      return;
    }
    const frame = requestAnimationFrame(() => publishChromeBounds());
    const afterLayout = setTimeout(() => publishChromeBounds(), 350);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(afterLayout);
    };
  }, [active, hidden, intro, anchorTop, publishChromeBounds]);

  useEffect(() => () => clearStudyChromeRect(), []);

  if (!active || hidden) return null;

  return (
    <Animated.View
      ref={anchorRef}
      collapsable={false}
      onLayout={publishChromeBounds}
      {...panResponder.panHandlers}
      style={[
        styles.anchor,
        {
          top: anchorTop,
          right: 0,
          height: SLOT_H,
          transform: [{ translateY: panY }],
        },
      ]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Task ${progress}: ${taskTitle}. Tap to open, drag to move.`}
    >
      <View style={[styles.pill, intro ? styles.pillExpanded : styles.pillMinimized]}>
        <LiquidGlassView
          style={StyleSheet.absoluteFill}
          interactive
          reduceTransparencyFallbackColor="#1A1A1A"
          androidOverlayColor={reduceTransparency ? '#1A1A1A' : 'transparent'}
        />
        <View style={styles.scrim} pointerEvents="none" />
        <View style={[styles.content, !intro && styles.contentMinimized]}>
          {intro ? (
            <Text numberOfLines={1} style={styles.expandedText}>
              Task: {taskTitle}
            </Text>
          ) : (
            <View style={styles.dotsStack}>
              <View style={styles.dot} />
              <View style={styles.dot} />
              <View style={styles.dot} />
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  pill: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: 'rgba(255,255,255,0.22)',
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: -2, height: 2 },
    elevation: 6,
  },
  pillExpanded: {
    minHeight: EXPANDED_MIN_H,
    maxWidth: 220,
    justifyContent: 'center',
  },
  pillMinimized: {
    width: MINIMIZED_W,
    height: MINIMIZED_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
  },
  contentMinimized: {
    paddingLeft: spacing.xs,
    paddingRight: 2,
    paddingVertical: spacing.sm,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SCRIM_COLOR,
  },
  expandedText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  dotsStack: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
    opacity: 0.95,
  },
});
