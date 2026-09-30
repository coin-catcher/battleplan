import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestSigner, canonicalRequest } from './request-signer.service';

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  });
});

describe('request signer', () => {
  const privatePem = readFileSync(new URL('../../../../keys/warplan-private.pem', import.meta.url), 'utf8');
  const publicKey = createPublicKey(readFileSync(new URL('../../../../keys/warplan-public.pem', import.meta.url)));

  it('stores the private key and signs the canonical request', async () => {
    const signer = new RequestSigner();
    await signer.importPem(privatePem);
    expect(signer.ready()).toBe(true);
    expect(memory.get('warplan.signingKey')).toContain('PRIVATE KEY');

    const raw = JSON.stringify({ initial_prompt: 'Plan it' });
    const signed = await signer.sign('post', '/projects', raw);
    const ok = verify(
      null,
      Buffer.from(canonicalRequest('POST', '/projects', signed.timestamp, raw)),
      publicKey,
      Buffer.from(signed.signature, 'base64'),
    );
    expect(ok).toBe(true);

    const restored = new RequestSigner();
    await restored.restore();
    expect(restored.ready()).toBe(true);

    signer.clear();
    expect(signer.ready()).toBe(false);
    await expect(signer.sign('GET', '/projects', '')).rejects.toThrow(/Import the signing key/);
  });

  it('rejects a value that is not a private key', async () => {
    const signer = new RequestSigner();
    await expect(signer.importPem('not a key')).rejects.toThrow(/PKCS8/);
    expect(signer.ready()).toBe(false);
  });
});