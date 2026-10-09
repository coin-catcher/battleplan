import { describe, expect, it } from 'vitest';
import { THEMES, THEME_AGENT_UI, type ThemeId } from './themes';

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('THEME_AGENT_UI', () => {
  it('defines toolbox and connection colors for every theme', () => {
    for (const theme of THEMES) {
      expect(THEME_AGENT_UI[theme.id as ThemeId]).toBeDefined();
    }
  });

  it('keeps readable contrast on green add buttons and connection indicators', () => {
    for (const theme of THEMES) {
      const ui = THEME_AGENT_UI[theme.id];
      expect(contrastRatio(ui.toolboxAddForeground, ui.toolboxAddBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ui.connectionOkForeground, ui.connectionOkBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ui.connectionErrorForeground, ui.connectionErrorBackground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
