export const THEMES = [
  { id: 'harbor', label: 'Harbor' },
  { id: 'grove', label: 'Grove' },
  { id: 'sunrise', label: 'Sunrise' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'glacier', label: 'Glacier' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'battleplan-theme';

export function readTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.some((theme) => theme.id === stored) ? stored as ThemeId : 'harbor';
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset['theme'] = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}
