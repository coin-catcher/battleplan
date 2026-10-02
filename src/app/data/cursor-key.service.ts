import { Injectable, inject } from '@angular/core';
import { AppPreferences } from './app-preferences.service';

@Injectable({ providedIn: 'root' })
export class CursorKey {
  private readonly preferences = inject(AppPreferences);

  readonly ready = this.preferences.ready;

  restore(): void {
    void this.preferences.restore();
  }

  value(): string {
    return this.preferences.cursorApiKey();
  }

  save(key: string): Promise<void> {
    return this.preferences.saveCursorApiKey(key);
  }

  clear(): Promise<void> {
    return this.preferences.clearCursorApiKey();
  }
}
