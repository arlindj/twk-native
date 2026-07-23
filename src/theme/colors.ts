/**
 * Named color scale — a HEX mirror of synth's web design tokens
 * (apps/web/app/globals.css), converted from the same HSL triplets so the
 * native app matches the web app's look exactly, in both light and dark.
 * Keep this in sync if the web tokens change (see DESIGN-TOKENS.md there).
 */
export type ColorScale = {
  /** App background. */
  paper: string;
  /** Raised surface (cards, sheets, modals). */
  card: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  ink2: string;
  /** Muted text. */
  ink3: string;
  /** Faint / placeholder / disabled text. */
  ink4: string;
  /** Border. */
  line: string;
  /** Subtler border. */
  lineSoft: string;
  /** Recessed well / hover row. */
  surface50: string;
  surface100: string;
  surface300: string;
  surface500: string;
  surface700: string;
  surface900: string;
  /** Primary action / links / focus ring (logo green). */
  brand: string;
  brand50: string;
  brand100: string;
  brand300: string;
  brand500: string;
  brand700: string;
  brand900: string;
  /** Positive state (reuses brand green). */
  success: string;
  successSoft: string;
  /** Caution (amber). */
  warn: string;
  warnSoft: string;
  /** Error / destructive (red). */
  danger: string;
  dangerSoft: string;
  /** Informational (logo teal). */
  info: string;
  /** Modal / sheet backdrop scrim. */
  overlay: string;
  /** Text that sits on a solid brand/danger fill — always white in both modes. */
  onBrand: string;
};

export const lightColors: ColorScale = {
  paper: '#FFFFFF',
  card: '#FFFFFF',
  ink: '#0F1729',
  ink2: '#344256',
  ink3: '#6B7280',
  ink4: '#8E96A4',
  line: '#E5E7EB',
  lineSoft: '#EEEFF2',
  surface50: '#F3F4F6',
  surface100: '#EBECF0',
  surface300: '#DCDFE4',
  surface500: '#6B7280',
  surface700: '#344256',
  surface900: '#0F1729',
  brand: '#0E8B4D',
  brand50: '#EBFAF1',
  brand100: '#CBF0DC',
  brand300: '#62CB96',
  brand500: '#14A363',
  brand700: '#0C6E3D',
  brand900: '#0D452E',
  success: '#0E8B4D',
  successSoft: '#DEF7E9',
  warn: '#DB7706',
  warnSoft: '#FDECCE',
  danger: '#DC2828',
  dangerSoft: '#FCE8E8',
  info: '#178277',
  overlay: 'rgba(15, 23, 41, 0.55)',
  onBrand: '#FFFFFF',
};

export const darkColors: ColorScale = {
  paper: '#0B111E',
  card: '#111827',
  ink: '#F3F5F7',
  ink2: '#C9D1D9',
  ink3: '#9CA4B4',
  ink4: '#6C7689',
  line: '#252D41',
  lineSoft: '#1D2434',
  surface50: '#1B2232',
  surface100: '#20283C',
  surface300: '#283248',
  surface500: '#9CA4B4',
  surface700: '#C9D1D9',
  surface900: '#F3F5F7',
  brand: '#2AC075',
  brand50: '#183929',
  brand100: '#214533',
  brand300: '#389466',
  brand500: '#2AC075',
  brand700: '#4BD28F',
  brand900: '#90DFB8',
  success: '#2AC075',
  successSoft: '#163B29',
  warn: '#F6A823',
  warnSoft: '#473515',
  danger: '#D02F2F',
  dangerSoft: '#451717',
  info: '#30CFBF',
  overlay: 'rgba(0, 0, 0, 0.65)',
  onBrand: '#FFFFFF',
};
