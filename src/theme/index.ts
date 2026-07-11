/**
 * Design tokens — restrained, document-like visual language with our
 * green brand color as the sole accent: pure white surfaces, warm
 * near-black ink, warm-gray secondary text, hairline borders instead of
 * shadows, compact radii, airy spacing, system typography (SF Pro).
 * Accent is used sparingly (primary CTA, progress).
 */
export const colors = {
  brand: '#0B7A4B',
  brandDark: '#075E39',
  brandLight: '#E6F5EE',
  brandMuted: '#8FCDB0',

  /** Warm near-black ink, not pure black. */
  ink: '#37352F',
  inkMuted: '#787774',
  inkFaint: '#9B9A97',

  /** Pure white canvas; warm gray for secondary surfaces + inputs. */
  bg: '#FFFFFF',
  card: '#FFFFFF',
  surface: '#F7F6F3',
  line: '#E9E9E7',

  danger: '#EB5757',
  dangerBg: '#FDEBEC',
  warning: '#D9730D',
  warningBg: '#FAEBDD',
  success: '#0F7B6C',
  successBg: '#EDF3F0',

  overlay: 'rgba(15, 15, 15, 0.6)',
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
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
  h1: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: colors.ink,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  h2: {
    fontSize: 21,
    fontWeight: '700' as const,
    color: colors.ink,
    lineHeight: 27,
    letterSpacing: -0.3,
  },
  h3: { fontSize: 16, fontWeight: '600' as const, color: colors.ink, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.inkMuted, lineHeight: 23 },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.inkFaint, lineHeight: 18 },
  button: { fontSize: 15, fontWeight: '600' as const },
} as const;
