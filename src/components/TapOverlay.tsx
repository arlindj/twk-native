import React, { useCallback } from 'react';
import { Dimensions, GestureResponderEvent, PixelRatio, View } from 'react-native';
import { track } from '../events/eventQueue';

/**
 * Touch Tracker — transparent capture layer over the prototype player.
 *
 * Uses onStartShouldSetResponderCapture to *observe* every touch that
 * enters the subtree and returns false so the touch still reaches the
 * WebView / prototype below. Coordinates are stored both raw and
 * normalized so the web replay can position markers on any video size.
 */
export function TapOverlay({
  taskId,
  getPrototypeScreenId,
  onTap,
  children,
}: {
  taskId: string;
  /** Called at tap time so the latest prototype screen is recorded. */
  getPrototypeScreenId?: () => string | undefined;
  /** Fired after each observed tap (used to schedule frame captures). */
  onTap?: () => void;
  children: React.ReactNode;
}) {
  const onCapture = useCallback(
    (e: GestureResponderEvent) => {
      const { pageX, pageY } = e.nativeEvent;
      const { width, height } = Dimensions.get('window');
      const prototypeScreenId = getPrototypeScreenId?.();
      onTap?.();
      track('tap', {
        taskId,
        x: Math.round(pageX),
        y: Math.round(pageY),
        normalizedX: Number((pageX / width).toFixed(4)),
        normalizedY: Number((pageY / height).toFixed(4)),
        screenWidth: Math.round(width),
        screenHeight: Math.round(height),
        pixelRatio: PixelRatio.get(),
        orientation: width > height ? 'landscape' : 'portrait',
        meta: { source: 'native', ...(prototypeScreenId ? { prototypeScreenId } : {}) },
      });
      return false; // never claim the touch — the prototype must receive it
    },
    [taskId, getPrototypeScreenId, onTap],
  );

  return (
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={onCapture}>
      {children}
    </View>
  );
}
