import { Injectable, signal } from '@angular/core';
import { hashes, sign } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

/** Keep in sync with faas/shared/src/signature.ts. */
const STORAGE_KEY = 'warplan.signingKey';
const ED25519_OID = new Uint8Array([0x2b, 0x65, 0x70]);
const PKCS8_ERROR = 'Paste a PKCS8 Ed25519 private key.';

// The static site is served over HTTP, where crypto.subtle does not exist.
hashes.sha512 = (message) => sha512(message);

@Injectable({ providedIn: 'root' })
export class RequestSigner {
  readonly ready = signal(false);
  private seed: Uint8Array | null = null;

  async restore(): Promise<void> {
    const pem = localStorage.getItem(STORAGE_KEY);
    if (!pem) {
      this.seed = null;
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
    this.seed = pkcs8Ed25519Seed(pemToBytes(normalized));
    if (persist) localStorage.setItem(STORAGE_KEY, normalized);
    this.ready.set(true);
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.seed = null;
    this.ready.set(false);
  }

  async sign(method: string, path: string, rawBody: string): Promise<{ timestamp: string; signature: string }> {
    if (!this.seed) throw new Error('Import the signing key before calling the API.');
    const timestamp = String(Date.now());
    const message = canonicalRequest(method, path, timestamp, rawBody);
    const signature = sign(new TextEncoder().encode(message), this.seed);
    return { timestamp, signature: bytesToBase64(signature) };
  }
}

export function canonicalRequest(method: string, target: string, timestamp: string, rawBody: string): string {
  return `v1\n${timestamp}\n${method.toUpperCase()}\n${target}\n${rawBody}`;
}

function pkcs8Ed25519Seed(bytes: Uint8Array): Uint8Array {
  const outer = readTlv(bytes, 0);
  if (outer.tag !== 0x30 || outer.next !== bytes.length) throw new Error(PKCS8_ERROR);
  const version = readTlv(bytes, outer.start);
  if (version.tag !== 0x02 || version.end - version.start !== 1 || bytes[version.start] !== 0) {
    throw new Error(PKCS8_ERROR);
  }
  const algorithm = readTlv(bytes, version.next);
  if (algorithm.tag !== 0x30) throw new Error(PKCS8_ERROR);
  const oid = readTlv(bytes, algorithm.start);
  if (
    oid.tag !== 0x06 ||
    !sameBytes(bytes.subarray(oid.start, oid.end), ED25519_OID) ||
    oid.next !== algorithm.end
  ) {
    throw new Error(PKCS8_ERROR);
  }
  const privateKey = readTlv(bytes, algorithm.next);
  if (privateKey.tag !== 0x04 || privateKey.next !== outer.end) throw new Error(PKCS8_ERROR);
  const nested = readTlv(bytes, privateKey.start);
  const seed = bytes.subarray(nested.start, nested.end);
  if (nested.tag !== 0x04 || seed.length !== 32 || nested.next !== privateKey.end) {
    throw new Error(PKCS8_ERROR);
  }
  return new Uint8Array(seed);
}

function readTlv(bytes: Uint8Array, offset: number): { tag: number; start: number; end: number; next: number } {
  if (offset + 2 > bytes.length) throw new Error(PKCS8_ERROR);
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let cursor = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || cursor + count > bytes.length) throw new Error(PKCS8_ERROR);
    length = 0;
    for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[cursor + index];
    cursor += count;
  }
  const end = cursor + length;
  if (end > bytes.length) throw new Error(PKCS8_ERROR);
  return { tag, start: cursor, end, next: end };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
