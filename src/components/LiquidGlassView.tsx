import React from 'react';
import { Platform, requireNativeComponent, StyleProp, ViewStyle } from 'react-native';
import { BlurView } from '@react-native-community/blur';

type Props = {
  style?: StyleProp<ViewStyle>;
  /** iOS 26+ only: enables UIGlassEffect's touch-responsive shimmer. */
  interactive?: boolean;
  /** Android fallback only (BlurView has no OS-level Reduce Transparency signal to read itself). */
  reduceTransparencyFallbackColor?: string;
  /** Android fallback only — solid color to show instead of blur when Reduce Transparency is on. */
  androidOverlayColor?: string;
};

const NativeLiquidGlassView =
  Platform.OS === 'ios' ? requireNativeComponent<Pick<Props, 'style' | 'interactive'>>('LiquidGlassView') : null;

/**
 * Apple's real Liquid Glass material (`UIGlassEffect`, iOS 26+) via a small
 * native view manager — see `ios/TWKParticipate/LiquidGlassView.swift`.
 * Falls back to the community `BlurView` on Android and on iOS < 26 (the
 * native view itself already degrades to a system blur there, but Android
 * has no `UIGlassEffect` equivalent at all).
 */
export function LiquidGlassView({
  style,
  interactive = false,
  reduceTransparencyFallbackColor,
  androidOverlayColor,
}: Props) {
  if (NativeLiquidGlassView) {
    return <NativeLiquidGlassView style={style} interactive={interactive} />;
  }
  return (
    <BlurView
      style={style}
      blurType="dark"
      blurAmount={20}
      reducedTransparencyFallbackColor={reduceTransparencyFallbackColor ?? '#1A1A1A'}
      overlayColor={androidOverlayColor ?? 'transparent'}
    />
  );
}
