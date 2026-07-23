import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type ColorScale } from './colors';
import { radius, spacing, type } from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

type ThemeContextValue = {
  colors: ColorScale;
  radius: typeof radius;
  spacing: typeof spacing;
  type: typeof type;
  /** The user's preference — 'system' follows the OS setting. */
  mode: ThemeMode;
  /** What's actually rendered right now ('system' resolved to light/dark). */
  resolvedMode: ResolvedMode;
  setMode: (mode: ThemeMode) => void;
  /** Flips light<->dark explicitly (drops 'system' the first time it's used). */
  toggleTheme: () => void;
};

const STORAGE_KEY = 'twk_theme_mode';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setModeState(saved);
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const resolvedMode: ResolvedMode =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const toggleTheme = () => setMode(resolvedMode === 'dark' ? 'light' : 'dark');

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: resolvedMode === 'dark' ? darkColors : lightColors,
      radius,
      spacing,
      type,
      mode,
      resolvedMode,
      setMode,
      toggleTheme,
    }),
    [mode, resolvedMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
