/**
 * Design tokens — matches synth's web app design system (green brand on
 * midnight-slate neutrals), light + dark. Color is theme-reactive: call
 * useTheme() inside a component to get the current ColorScale; radius/spacing/
 * type are static (no color) and can be imported directly.
 */
export { ThemeProvider, useTheme } from './ThemeContext';
export type { ThemeMode, ResolvedMode } from './ThemeContext';
export { lightColors, darkColors } from './colors';
export type { ColorScale } from './colors';
export { radius, spacing, type } from './tokens';
