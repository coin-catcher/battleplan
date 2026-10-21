import { Injectable, signal } from '@angular/core';
import type { ThemeId } from '../core/themes';
import { THEMES } from '../core/themes';
import { electronBridge, isElectronApp } from './electron-bridge';

export interface AppWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppPreferencesDocument {
  current_project_id: string | null;
  cursor_api_key: string;
  github_pat: string;
  theme: ThemeId;
  pane_width: number;
  auto_save: boolean;
  open_project_ids: string[];
  window_maximized: boolean;
  window_bounds: AppWindowBounds | null;
}

const CURSOR_KEY = 'battleplan-cursor-api-key';
const GITHUB_PAT_KEY = 'battleplan-github-pat';
const THEME_KEY = 'battleplan-theme';
const PANE_KEY = 'battleplan-pane-width';
const CURRENT_PROJECT_KEY = 'battleplan-current-project';
const AUTO_SAVE_KEY = 'battleplan-auto-save';
const OPEN_PROJECTS_KEY = 'battleplan-open-project-ids';

@Injectable({ providedIn: 'root' })
export class AppPreferences {
  readonly ready = signal(false);
  private cached: AppPreferencesDocument = {
    current_project_id: null,
    cursor_api_key: '',
    github_pat: '',
    theme: 'harbor',
    pane_width: 420,
    auto_save: false,
    open_project_ids: [],
    window_maximized: false,
    window_bounds: null,
  };

  async restore(): Promise<void> {
    if (isElectronApp()) {
      const config = await electronBridge()!.invoke<AppPreferencesDocument>('config:read');
      this.cached = {
        current_project_id: config.current_project_id,
        cursor_api_key: config.cursor_api_key ?? '',
        github_pat: config.github_pat ?? '',
        theme: normalizeTheme(config.theme),
        pane_width: normalizePaneWidth(config.pane_width),
        auto_save: Boolean(config.auto_save),
        open_project_ids: normalizeOpenProjectIds(config.open_project_ids),
        window_maximized: Boolean(config.window_maximized),
        window_bounds: normalizeWindowBounds(config.window_bounds),
      };
    } else {
      this.cached = {
        current_project_id: localStorage.getItem(CURRENT_PROJECT_KEY),
        cursor_api_key: localStorage.getItem(CURSOR_KEY) ?? '',
        github_pat: localStorage.getItem(GITHUB_PAT_KEY) ?? '',
        theme: normalizeTheme(localStorage.getItem(THEME_KEY)),
        pane_width: normalizePaneWidth(Number(localStorage.getItem(PANE_KEY))),
        auto_save: localStorage.getItem(AUTO_SAVE_KEY) === '1',
        open_project_ids: normalizeOpenProjectIds(readJsonArray(localStorage.getItem(OPEN_PROJECTS_KEY))),
        window_maximized: false,
        window_bounds: null,
      };
    }
    this.ready.set(this.cached.cursor_api_key.trim().length > 0);
  }

  currentProjectId(): string | null {
    return this.cached.current_project_id;
  }

  async setCurrentProjectId(projectId: string | null): Promise<void> {
    this.cached.current_project_id = projectId;
    await this.persist({ current_project_id: projectId });
  }

  cursorApiKey(): string {
    return this.cached.cursor_api_key;
  }

  async saveCursorApiKey(key: string): Promise<void> {
    const next = key.trim();
    if (!next) throw new Error('Paste a Cursor API key.');
    this.cached.cursor_api_key = next;
    await this.persist({ cursor_api_key: next });
    this.ready.set(true);
  }

  async clearCursorApiKey(): Promise<void> {
    this.cached.cursor_api_key = '';
    await this.persist({ cursor_api_key: '' });
    this.ready.set(false);
  }

  githubPat(): string {
    return this.cached.github_pat;
  }

  async saveGithubPat(token: string): Promise<void> {
    const next = token.trim();
    if (!next) throw new Error('Paste a GitHub personal access token.');
    this.cached.github_pat = next;
    await this.persist({ github_pat: next });
  }

  async clearGithubPat(): Promise<void> {
    this.cached.github_pat = '';
    await this.persist({ github_pat: '' });
  }

  theme(): ThemeId {
    return this.cached.theme;
  }

  async saveTheme(theme: ThemeId): Promise<void> {
    this.cached.theme = theme;
    await this.persist({ theme });
  }

  paneWidth(): number {
    return this.cached.pane_width;
  }

  async savePaneWidth(width: number): Promise<void> {
    this.cached.pane_width = normalizePaneWidth(width);
    await this.persist({ pane_width: this.cached.pane_width });
  }

  autoSave(): boolean {
    return this.cached.auto_save;
  }

  async saveAutoSave(enabled: boolean): Promise<void> {
    this.cached.auto_save = enabled;
    await this.persist({ auto_save: enabled });
  }

  openProjectIds(): string[] {
    return [...this.cached.open_project_ids];
  }

  async saveOpenSession(openProjectIds: string[], currentProjectId: string | null): Promise<void> {
    const open_project_ids = normalizeOpenProjectIds(openProjectIds);
    this.cached.open_project_ids = open_project_ids;
    this.cached.current_project_id = currentProjectId;
    await this.persist({ open_project_ids, current_project_id: currentProjectId });
  }

  private async persist(patch: Partial<AppPreferencesDocument>): Promise<void> {
    if (isElectronApp()) {
      await electronBridge()!.invoke('config:write', patch);
      return;
    }
    if (patch.current_project_id !== undefined) {
      if (patch.current_project_id) localStorage.setItem(CURRENT_PROJECT_KEY, patch.current_project_id);
      else localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
    if (patch.cursor_api_key !== undefined) {
      if (patch.cursor_api_key) localStorage.setItem(CURSOR_KEY, patch.cursor_api_key);
      else localStorage.removeItem(CURSOR_KEY);
    }
    if (patch.github_pat !== undefined) {
      if (patch.github_pat) localStorage.setItem(GITHUB_PAT_KEY, patch.github_pat);
      else localStorage.removeItem(GITHUB_PAT_KEY);
    }
    if (patch.theme !== undefined) localStorage.setItem(THEME_KEY, patch.theme);
    if (patch.pane_width !== undefined) localStorage.setItem(PANE_KEY, String(patch.pane_width));
    if (patch.auto_save !== undefined) {
      if (patch.auto_save) localStorage.setItem(AUTO_SAVE_KEY, '1');
      else localStorage.removeItem(AUTO_SAVE_KEY);
    }
    if (patch.open_project_ids !== undefined) {
      localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(patch.open_project_ids));
    }
  }
}

function readJsonArray(raw: string | null): unknown {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function normalizeOpenProjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeWindowBounds(value: Partial<AppWindowBounds> | null | undefined): AppWindowBounds | null {
  if (!value) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((entry) => Number.isFinite(Number(entry)))) return null;
  return {
    x: Math.round(Number(x)),
    y: Math.round(Number(y)),
    width: Math.round(Number(width)),
    height: Math.round(Number(height)),
  };
}

function normalizeTheme(value: string | null | undefined): ThemeId {
  return THEMES.some((theme) => theme.id === value) ? value as ThemeId : 'harbor';
}

function normalizePaneWidth(value: number): number {
  if (!Number.isFinite(value)) return 420;
  return Math.min(720, Math.max(280, Math.round(value)));
}
