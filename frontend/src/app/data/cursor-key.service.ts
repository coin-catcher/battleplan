import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'warplan-cursor-api-key';

@Injectable({ providedIn: 'root' })
export class CursorKey {
  readonly ready = signal(false);
  private key = '';

  restore(): void {
    this.key = localStorage.getItem(STORAGE_KEY) ?? '';
    this.ready.set(this.key.trim().length > 0);
  }

  value(): string {
    return this.key;
  }

  save(key: string): void {
    const next = key.trim();
    if (!next) throw new Error('Paste a Cursor API key.');
    this.key = next;
    localStorage.setItem(STORAGE_KEY, next);
    this.ready.set(true);
  }

  clear(): void {
    this.key = '';
    localStorage.removeItem(STORAGE_KEY);
    this.ready.set(false);
  }
}
