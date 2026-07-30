/**
 * Live bounds of study chrome (FloatingTaskControl) in window coordinates.
 * Taps inside this rect must never become heatmap clicks — only prototype UI
 * interactions count.
 */
export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const HIT_PAD = 10;

let chromeRect: ScreenRect | null = null;

export function setStudyChromeRect(rect: ScreenRect | null) {
  chromeRect = rect;
}

export function clearStudyChromeRect() {
  chromeRect = null;
}

export function getStudyChromeRect(): ScreenRect | null {
  return chromeRect;
}

export function isStudyChromePoint(pageX: number, pageY: number): boolean {
  if (!chromeRect) return false;
  return (
    pageX >= chromeRect.x - HIT_PAD &&
    pageX <= chromeRect.x + chromeRect.width + HIT_PAD &&
    pageY >= chromeRect.y - HIT_PAD &&
    pageY <= chromeRect.y + chromeRect.height + HIT_PAD
  );
}

export function isStudyChromeNormalizedPoint(
  normalizedX: number,
  normalizedY: number,
  screenWidth: number,
  screenHeight: number,
): boolean {
  return isStudyChromePoint(normalizedX * screenWidth, normalizedY * screenHeight);
}

type TapLike = {
  x?: number;
  y?: number;
  normalizedX?: number;
  normalizedY?: number;
  screenWidth?: number;
  screenHeight?: number;
  meta?: Record<string, string | number | boolean>;
};

/** Last-line guard before a tap becomes a heatmap beat. */
export function shouldExcludeTapFromHeatmap(tap: TapLike): boolean {
  if (tap.meta?.excludeFromHeatmap === true || tap.meta?.studyChrome === true) {
    return true;
  }
  const w = tap.screenWidth ?? 0;
  const h = tap.screenHeight ?? 0;
  if (tap.normalizedX != null && tap.normalizedY != null && w > 0 && h > 0) {
    if (isStudyChromeNormalizedPoint(tap.normalizedX, tap.normalizedY, w, h)) return true;
  }
  if (tap.x != null && tap.y != null) {
    if (isStudyChromePoint(tap.x, tap.y)) return true;
  }
  return false;
}
