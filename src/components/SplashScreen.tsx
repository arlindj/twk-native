import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { spacing, useTheme } from '../theme';

/**
 * Animated splash shown on cold start, over a plain canvas that matches
 * the native launch screen (so the handoff is seamless). The brand mark
 * scales + fades in, the wordmark follows, a short hold, then the whole
 * overlay fades out and calls onFinish.
 *
 * Uses only the built-in Animated API — no extra dependency.
 */
export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const { colors } = useTheme();
  const markScale = useRef(new Animated.Value(0.8)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(markOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(markScale, {
          toValue: 1,
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(wordOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(650),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 320,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onFinish();
    });
  }, [markOpacity, markScale, wordOpacity, overlayOpacity, onFinish]);

  return (
    <Animated.View
      style={[styles.overlay, { backgroundColor: colors.paper, opacity: overlayOpacity }]}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.mark,
          { backgroundColor: colors.brand, opacity: markOpacity, transform: [{ scale: markScale }] },
        ]}
      >
        <Text style={[styles.markText, { color: colors.onBrand }]}>T</Text>
      </Animated.View>
      <Animated.Text style={[styles.word, { color: colors.ink, opacity: wordOpacity }]}>
        TWK Participate
      </Animated.Text>
    </Animated.View>
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
  mark: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontSize: 38, fontWeight: '800' },
  word: {
    marginTop: spacing.md,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
