export const MINDMAP_THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
] as const;

export type MindmapThemeId = (typeof MINDMAP_THEMES)[number]['id'];

export function normalizeMindmapTheme(value: unknown): MindmapThemeId {
  return value === 'light' ? 'light' : 'dark';
}