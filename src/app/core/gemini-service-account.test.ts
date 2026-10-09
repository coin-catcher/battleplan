import { describe, expect, it } from 'vitest';
import {
  parseGeminiModelNames,
  parseGoogleServiceAccountJson,
  type GoogleServiceAccountJson,
} from './gemini-service-account';

const sampleCredentials = (): GoogleServiceAccountJson => ({
  type: 'service_account',
  project_id: 'gen-lang-client-0885106111',
  private_key_id: 'c7dc32ba9f6cd7b8e8f5f0842cde78f5636c4ed7',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----\n',
  client_email: 'battleplan@gen-lang-client-0885106111.iam.gserviceaccount.com',
  client_id: '103519801238489504564',
  token_uri: 'https://oauth2.googleapis.com/token',
  universe_domain: 'googleapis.com',
});

describe('parseGoogleServiceAccountJson', () => {
  it('accepts a complete service account object', () => {
    const parsed = parseGoogleServiceAccountJson(JSON.stringify(sampleCredentials()));
    expect(parsed.client_email).toContain('battleplan@');
  });

  it('rejects missing private_key PEM', () => {
    const creds = { ...sampleCredentials(), private_key: 'not-a-pem' };
    expect(() => parseGoogleServiceAccountJson(JSON.stringify(creds))).toThrow(/private_key/i);
  });

  it('rejects empty private_key', () => {
    const creds = { ...sampleCredentials(), private_key: '' };
    expect(() => parseGoogleServiceAccountJson(JSON.stringify(creds))).toThrow(/private_key/i);
  });
});

describe('parseGeminiModelNames', () => {
  it('extracts short gemini model ids', () => {
    const names = parseGeminiModelNames({
      models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }],
    });
    expect(names).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });
});
