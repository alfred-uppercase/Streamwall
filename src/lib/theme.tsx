import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ThemeMode, UserThemePreference } from '../shared/types';
import { api, useAuth } from './client';

export interface ThemePreset {
  id: string;
  label: string;
  mode: ThemeMode;
  accentHex: string;
  surfaceHint: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'ambre',
    label: 'Ambre Cinéma',
    mode: 'dark',
    accentHex: '#e6a82e',
    surfaceHint: '#11141d',
  },
  {
    id: 'rubis',
    label: 'Rubis Studio',
    mode: 'dark',
    accentHex: '#ef4444',
    surfaceHint: '#141115',
  },
  {
    id: 'emeraude',
    label: 'Émeraude Nuit',
    mode: 'dark',
    accentHex: '#10b981',
    surfaceHint: '#0f1615',
  },
  {
    id: 'saphir',
    label: 'Saphir Minuit',
    mode: 'dark',
    accentHex: '#38bdf8',
    surfaceHint: '#0f141c',
  },
  {
    id: 'amethyste',
    label: 'Améthyste',
    mode: 'dark',
    accentHex: '#a855f7',
    surfaceHint: '#14111b',
  },
  {
    id: 'clair',
    label: 'Clair Éditorial',
    mode: 'light',
    accentHex: '#d97706',
    surfaceHint: '#f8fafc',
  },
];

export const DEFAULT_THEME: UserThemePreference = {
  presetId: 'ambre',
  mode: 'dark',
  accentHex: '#e6a82e',
};

const STORAGE_THEME_KEY = 'tapenaka_theme_prefs';

function readStoredTheme(): UserThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_THEME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserThemePreference>;
      if (parsed && typeof parsed.accentHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.accentHex)) {
        return {
          presetId: parsed.presetId || 'custom',
          mode: parsed.mode === 'light' ? 'light' : 'dark',
          accentHex: parsed.accentHex,
        };
      }
    }
  } catch {
    // Ignore storage read failure
  }
  return DEFAULT_THEME;
}

function writeStoredTheme(pref: UserThemePreference): void {
  try {
    localStorage.setItem(STORAGE_THEME_KEY, JSON.stringify(pref));
  } catch {
    // Ignore storage write failure
  }
}

function getContrastForeground(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  return lum > 0.36 ? '#0f172a' : '#ffffff';
}

function applyThemeToDocument(pref: UserThemePreference): void {
  const root = document.documentElement;
  const isLight = pref.mode === 'light';
  root.classList.toggle('dark', !isLight);

  if (isLight) {
    root.style.setProperty('--background', '#f6f7f9');
    root.style.setProperty('--foreground', '#0f172a');
    root.style.setProperty('--card', '#ffffff');
    root.style.setProperty('--card-foreground', '#0f172a');
    root.style.setProperty('--popover', '#ffffff');
    root.style.setProperty('--popover-foreground', '#0f172a');
    root.style.setProperty('--secondary', '#eef1f5');
    root.style.setProperty('--secondary-foreground', '#0f172a');
    root.style.setProperty('--muted', '#eef1f5');
    root.style.setProperty('--muted-foreground', '#475569');
    root.style.setProperty('--accent', '#f1f5f9');
    root.style.setProperty('--accent-foreground', '#0f172a');
    root.style.setProperty('--border', '#e2e8f0');
    root.style.setProperty('--input', '#cbd5e1');
  } else {
    root.style.setProperty('--background', 'oklch(0.14 0.01 260)');
    root.style.setProperty('--foreground', 'oklch(0.96 0.005 260)');
    root.style.setProperty('--card', 'oklch(0.19 0.012 260)');
    root.style.setProperty('--card-foreground', 'oklch(0.96 0.005 260)');
    root.style.setProperty('--popover', 'oklch(0.19 0.012 260)');
    root.style.setProperty('--popover-foreground', 'oklch(0.96 0.005 260)');
    root.style.setProperty('--secondary', 'oklch(0.24 0.012 260)');
    root.style.setProperty('--secondary-foreground', 'oklch(0.96 0.005 260)');
    root.style.setProperty('--muted', 'oklch(0.24 0.012 260)');
    root.style.setProperty('--muted-foreground', 'oklch(0.68 0.015 260)');
    root.style.setProperty('--accent', 'oklch(0.26 0.015 260)');
    root.style.setProperty('--accent-foreground', 'oklch(0.96 0.005 260)');
    root.style.setProperty('--border', 'oklch(0.27 0.012 260)');
    root.style.setProperty('--input', 'oklch(0.3 0.012 260)');
  }

  root.style.setProperty('--primary', pref.accentHex);
  root.style.setProperty('--ring', pref.accentHex);
  root.style.setProperty('--primary-foreground', getContrastForeground(pref.accentHex));
}

interface ThemeContextValue {
  theme: UserThemePreference;
  applyAndSaveTheme: (next: UserThemePreference) => Promise<void>;
  resetTheme: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, isMember } = useAuth();
  const [theme, setTheme] = useState<UserThemePreference>(() => readStoredTheme());

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Sync saved user theme from backend when signing in
  useEffect(() => {
    if (user?.theme && /^#[0-9a-fA-F]{6}$/.test(user.theme.accentHex)) {
      setTheme(user.theme);
      writeStoredTheme(user.theme);
    }
  }, [user?.id, user?.theme]);

  const applyAndSaveTheme = useCallback(
    async (next: UserThemePreference) => {
      const normalized: UserThemePreference = {
        presetId: next.presetId || 'custom',
        mode: next.mode === 'light' ? 'light' : 'dark',
        accentHex: /^#[0-9a-fA-F]{6}$/.test(next.accentHex) ? next.accentHex : DEFAULT_THEME.accentHex,
      };
      setTheme(normalized);
      writeStoredTheme(normalized);
      if (isMember) {
        try {
          await api.updateTheme(normalized);
        } catch {
          // Local storage remains updated even if offline
        }
      }
    },
    [isMember]
  );

  const resetTheme = useCallback(async () => {
    setTheme(DEFAULT_THEME);
    writeStoredTheme(DEFAULT_THEME);
    if (isMember) {
      try {
        await api.updateTheme(null);
      } catch {
        // Ignore error
      }
    }
  }, [isMember]);

  const value = useMemo(
    () => ({ theme, applyAndSaveTheme, resetTheme }),
    [theme, applyAndSaveTheme, resetTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
