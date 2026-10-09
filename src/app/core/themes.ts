export const THEMES = [
  { id: 'harbor', label: 'Harbor' },
  { id: 'grove', label: 'Grove' },
  { id: 'sunrise', label: 'Sunrise' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'glacier', label: 'Glacier' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** Agent library UI colors per theme (mirrored as CSS vars in styles.scss). */
export const THEME_AGENT_UI: Record<
  ThemeId,
  {
    toolboxAddBackground: string;
    toolboxAddForeground: string;
    connectionOkBackground: string;
    connectionOkForeground: string;
    connectionErrorBackground: string;
    connectionErrorForeground: string;
    toolboxIconBackground: string;
  }
> = {
  harbor: {
    toolboxAddBackground: '#2e7d32',
    toolboxAddForeground: '#ffffff',
    connectionOkBackground: '#1f6b3a',
    connectionOkForeground: '#e8f7ed',
    connectionErrorBackground: '#7a1f1f',
    connectionErrorForeground: '#ffe8e8',
    toolboxIconBackground: '#ffffff',
  },
  grove: {
    toolboxAddBackground: '#3d7a2a',
    toolboxAddForeground: '#ffffff',
    connectionOkBackground: '#2f6b28',
    connectionOkForeground: '#e8f5e0',
    connectionErrorBackground: '#7a1f1f',
    connectionErrorForeground: '#ffe8e8',
    toolboxIconBackground: '#fffcf6',
  },
  sunrise: {
    toolboxAddBackground: '#2e7d32',
    toolboxAddForeground: '#ffffff',
    connectionOkBackground: '#1f6b3a',
    connectionOkForeground: '#e8f7ed',
    connectionErrorBackground: '#8b2222',
    connectionErrorForeground: '#ffe8e8',
    toolboxIconBackground: '#fffdfb',
  },
  dusk: {
    toolboxAddBackground: '#4caf50',
    toolboxAddForeground: '#0a1a0c',
    connectionOkBackground: '#2e7d46',
    connectionOkForeground: '#e8f7ed',
    connectionErrorBackground: '#9a3030',
    connectionErrorForeground: '#ffe8e8',
    toolboxIconBackground: '#221e2b',
  },
  glacier: {
    toolboxAddBackground: '#2e7d32',
    toolboxAddForeground: '#ffffff',
    connectionOkBackground: '#1f6b3a',
    connectionOkForeground: '#e8f7ed',
    connectionErrorBackground: '#7a1f1f',
    connectionErrorForeground: '#ffe8e8',
    toolboxIconBackground: '#ffffff',
  },
};

const STORAGE_KEY = 'battleplan-theme';

export function readTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.some((theme) => theme.id === stored) ? stored as ThemeId : 'harbor';
}

export function applyTheme(theme: ThemeId, persist = true): void {
  document.documentElement.dataset['theme'] = theme;
  if (persist && typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, theme);
}
