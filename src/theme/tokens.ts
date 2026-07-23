/**
 * Non-color tokens — radius, spacing, and the type scale (sizes/weights only;
 * color comes from the current theme via useTheme(), not baked in here).
 * Radius mirrors synth's web scale (--radius: 0.75rem base): sm/md/lg/xl/xxl
 * step by 4px like the web's rounded-sm…2xl, so cards/sheets/tiles read the
 * same on both.
 */
export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const type = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34, letterSpacing: -0.4 },
  h2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: '600' as const, lineHeight: 23 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  button: { fontSize: 15, fontWeight: '600' as const },
} as const;
