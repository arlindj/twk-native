/**
 * Design tokens — Maze-inspired visual language with a green brand color.
 * Maze uses a saturated primary on white cards, generous radii and bold,
 * dark typography; we mirror that structure with our own palette.
 */
export const colors = {
  brand: '#0B7A4B',
  brandDark: '#075E39',
  brandLight: '#E6F5EE',
  brandMuted: '#8FCDB0',

  ink: '#101828',
  inkMuted: '#475467',
  inkFaint: '#98A2B3',

  bg: '#F7FAF8',
  card: '#FFFFFF',
  line: '#E4E7EC',

  danger: '#D92D20',
  dangerBg: '#FEF3F2',
  warning: '#B54708',
  warningBg: '#FFFAEB',
  success: '#067647',
  successBg: '#ECFDF3',

  overlay: 'rgba(16, 24, 40, 0.55)',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
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
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.ink, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '700' as const, color: colors.ink, lineHeight: 28 },
  h3: { fontSize: 17, fontWeight: '600' as const, color: colors.ink, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.inkMuted, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.inkFaint, lineHeight: 18 },
  button: { fontSize: 16, fontWeight: '600' as const },
} as const;
