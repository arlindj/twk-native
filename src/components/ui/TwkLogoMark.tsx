import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Svg, { G, Mask, Path } from 'react-native-svg';

/**
 * TawakkalnaOS logo mark — same three-tone green glyph as the web app
 * (`apps/web/core/ui/logo.tsx`). Colors are baked into the SVG paths so it
 * reads identically in light and dark mode.
 */
export function TwkLogoMark({
  size = 20,
  style,
  accessibilityLabel = 'TawakkalnaOS',
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const maskId = React.useId().replace(/:/g, '');

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 79 79"
      fill="none"
      style={style}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="79" height="79">
        <Path
          d="M39.4049 0C69.2837 0 78.809 9.5237 78.809 39.3976C78.809 69.2714 69.2837 78.7951 39.4049 78.7951C9.52613 78.7951 0.000854492 69.2714 0.000854492 39.3976C0.000854492 9.5237 9.52613 0 39.4049 0Z"
          fill="#fff"
        />
      </Mask>
      <G mask={`url(#${maskId})`}>
        <Path
          d="M39.4046 78.795H0.000488281V39.3975C10.4511 39.3975 20.4737 43.5483 27.8634 50.9368C35.2531 58.3252 39.4046 68.3462 39.4046 78.795Z"
          fill="#114B47"
        />
        <Path
          d="M40.946 0C45.8463 0.380744 50.4288 2.57354 53.7991 6.1504C57.1695 9.72726 59.0858 14.4315 59.1741 19.3449C59.2624 24.2583 57.5163 29.0283 54.2766 32.7239C51.0369 36.4195 46.5361 38.7754 41.6527 39.3319C51.6973 38.7578 61.1419 34.3639 68.0503 27.0508C74.9587 19.7377 78.8076 10.0594 78.808 0L40.946 0Z"
          fill="#1B7A5F"
        />
        <Path
          d="M19.6372 19.6988C19.6379 14.7246 21.5148 9.9336 24.8932 6.28216C28.2715 2.63072 32.9029 0.387412 37.8628 0L0.000854492 0V39.3976H37.8628C32.9029 39.0101 28.2715 36.7668 24.8932 33.1154C21.5148 29.464 19.6372 24.673 19.6372 19.6988Z"
          fill="#1AAA5B"
        />
      </G>
    </Svg>
  );
}
