/**
 * Perceptual-hash helpers shared by the frame-clustering stores.
 *
 * Canvas-rendered prototypes (Figma) expose no screen identity, so the app
 * snapshots the viewport after each tap and uploads it. Frames are clustered
 * by perceptual hash: visually-identical captures map to one stable screen
 * key, and the first capture becomes that screen's canonical image.
 */
import Jimp from 'jimp';

// 256-bit hash; two captures of the same frame differ only by antialiasing
// noise (distance < ~25), different frames differ by 60+ in practice.
export const SAME_SCREEN_THRESHOLD = 30;

export async function perceptualHash(buffer) {
  const img = await Jimp.read(buffer);
  img.resize(16, 16, Jimp.RESIZE_BILINEAR).greyscale();
  const px = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px.push(Jimp.intToRGBA(img.getPixelColor(x, y)).r);
    }
  }
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  const variance = px.reduce((a, b) => a + (b - mean) ** 2, 0) / px.length;
  return {
    hash: px.map((v) => (v > mean ? '1' : '0')).join(''),
    // Near-zero variance = uniform image (white page still loading, black
    // transition frame) — worthless as a screen, must not enter the registry.
    uniform: Math.sqrt(variance) < 6,
  };
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
