import { Injectable, signal } from '@angular/core';

/** Keep in sync with faas/shared/src/signature.ts. */
const STORAGE_KEY = 'warplan.signingKey';

@Injectable({ providedIn: 'root' })
export class RequestSigner {
  readonly ready = signal(false);
  private key: CryptoKey | null = null;

  async restore(): Promise<void> {
    const pem = localStorage.getItem(STORAGE_KEY);
    if (!pem) {
      this.key = null;
      this.ready.set(false);
      return;
    }
    try {
      await this.importPem(pem, false);
    } catch {
      this.clear();
    }
  }

  async importPem(pem: string, persist = true): Promise<void> {
    const normalized = pem.trim();
    if (!normalized.includes('PRIVATE KEY')) {
      throw new Error('Paste a PKCS8 PEM private key.');
    }
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToBytes(normalized),
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    this.key = key;
    if (persist) localStorage.setItem(STORAGE_KEY, normalized);
    this.ready.set(true);
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.key = null;
    this.ready.set(false);
  }

  async sign(method: string, path: string, rawBody: string): Promise<{ timestamp: string; signature: string }> {
    if (!this.key) throw new Error('Import the signing key before calling the API.');
    const timestamp = String(Date.now());
    const message = canonicalRequest(method, path, timestamp, rawBody);
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, this.key, new TextEncoder().encode(message));
    return { timestamp, signature: bytesToBase64(new Uint8Array(signature)) };
  }
}

export function canonicalRequest(method: string, target: string, timestamp: string, rawBody: string): string {
  return `v1\n${timestamp}\n${method.toUpperCase()}\n${target}\n${rawBody}`;
}

function pemToBytes(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
