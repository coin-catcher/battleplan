import { Injectable, signal } from '@angular/core';
import type { ThemeId } from '../core/themes';
import { THEMES } from '../core/themes';
import { electronBridge, isElectronApp } from './electron-bridge';

export interface AppPreferencesDocument {
  current_project_id: string | null;
  cursor_api_key: string;
  theme: ThemeId;
  pane_width: number;
  auto_save: boolean;
}

const CURSOR_KEY = 'battleplan-cursor-api-key';
const THEME_KEY = 'battleplan-theme';
const PANE_KEY = 'battleplan-pane-width';
const CURRENT_PROJECT_KEY = 'battleplan-current-project';
const AUTO_SAVE_KEY = 'battleplan-auto-save';

@Injectable({ providedIn: 'root' })
export class AppPreferences {
  readonly ready = signal(false);
  private cached: AppPreferencesDocument = {
    current_project_id: null,
    cursor_api_key: '',
    theme: 'harbor',
    pane_width: 420,
    auto_save: false,
  };

  async restore(): Promise<void> {
    if (isElectronApp()) {
      const config = await electronBridge()!.invoke<AppPreferencesDocument>('config:read');
      this.cached = {
        current_project_id: config.current_project_id,
        cursor_api_key: config.cursor_api_key ?? '',
        theme: normalizeTheme(config.theme),
        pane_width: normalizePaneWidth(config.pane_width),
        auto_save: Boolean(config.auto_save),
      };
    } else {
      this.cached = {
        current_project_id: localStorage.getItem(CURRENT_PROJECT_KEY),
        cursor_api_key: localStorage.getItem(CURSOR_KEY) ?? '',
        theme: normalizeTheme(localStorage.getItem(THEME_KEY)),
        pane_width: normalizePaneWidth(Number(localStorage.getItem(PANE_KEY))),
        auto_save: localStorage.getItem(AUTO_SAVE_KEY) === '1',
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
    if (patch.theme !== undefined) localStorage.setItem(THEME_KEY, patch.theme);
    if (patch.pane_width !== undefined) localStorage.setItem(PANE_KEY, String(patch.pane_width));
    if (patch.auto_save !== undefined) {
      if (patch.auto_save) localStorage.setItem(AUTO_SAVE_KEY, '1');
      else localStorage.removeItem(AUTO_SAVE_KEY);
    }
  }
}

function normalizeTheme(value: string | null | undefined): ThemeId {
  return THEMES.some((theme) => theme.id === value) ? value as ThemeId : 'harbor';
}

function normalizePaneWidth(value: number): number {
  if (!Number.isFinite(value)) return 420;
  return Math.min(720, Math.max(280, Math.round(value)));
}
