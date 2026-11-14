import { describe, expect, it } from 'vitest';
import { normalizeMindmapTheme } from './mindmap-theme';

describe('normalizeMindmapTheme', () => {
  it('defaults unknown values to dark', () => {
    expect(normalizeMindmapTheme(undefined)).toBe('dark');
    expect(normalizeMindmapTheme('harbor')).toBe('dark');
  });

  it('accepts light', () => {
    expect(normalizeMindmapTheme('light')).toBe('light');
  });
});