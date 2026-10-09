import { SignJWT, importPKCS8 } from 'jose';

/** Google Cloud service account key file (stored in ProjectAgent.api_key for Gemini agents). */
export interface GoogleServiceAccountJson {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri?: string;
  token_uri: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
}

const GEMINI_OAUTH_SCOPE = 'https://www.googleapis.com/auth/generative-language';

const REQUIRED_SERVICE_ACCOUNT_FIELDS: (keyof GoogleServiceAccountJson)[] = [
  'type',
  'project_id',
  'private_key_id',
  'private_key',
  'client_email',
  'client_id',
  'token_uri',
];

export function agentUsesServiceAccountJson(type: string): boolean {
  return type === 'Gemini';
}

export function agentCredentialFieldLabel(type: string): string {
  return agentUsesServiceAccountJson(type) ? 'Service account JSON' : 'API key';
}

export function parseGoogleServiceAccountJson(raw: string): GoogleServiceAccountJson {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Paste the full Google Cloud service account JSON key.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Service account credentials must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Service account credentials must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  for (const field of REQUIRED_SERVICE_ACCOUNT_FIELDS) {
    if (typeof record[field] !== 'string' || !String(record[field]).trim()) {
      throw new Error(`Service account JSON is missing required field "${field}".`);
    }
  }
  if (record['type'] !== 'service_account') {
    throw new Error('JSON type must be "service_account".');
  }
  if (!String(record['private_key']).includes('BEGIN PRIVATE KEY')) {
    throw new Error('Service account JSON must include a PEM private_key.');
  }
  return record as GoogleServiceAccountJson;
}

type TokenCacheEntry = { cacheKey: string; token: string; expiresAtMs: number };

let accessTokenCache: TokenCacheEntry | null = null;

function cacheKeyFor(credentials: GoogleServiceAccountJson): string {
  return `${credentials.client_email}:${credentials.private_key_id}`;
}

export function clearGeminiAccessTokenCache(): void {
  accessTokenCache = null;
}

export async function fetchGoogleAccessToken(
  credentials: GoogleServiceAccountJson,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const cacheKey = cacheKeyFor(credentials);
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.cacheKey === cacheKey && accessTokenCache.expiresAtMs > now + 60_000) {
    return accessTokenCache.token;
  }

  const privateKey = await importPKCS8(credentials.private_key.replace(/\\n/g, '\n'), 'RS256');
  const issuedAt = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: GEMINI_OAUTH_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.client_email)
    .setSubject(credentials.client_email)
    .setAudience(credentials.token_uri)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(privateKey);

  const response = await fetchFn(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const bodyText = await response.text();
  let payload: Record<string, unknown> = {};
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      payload = { error: bodyText };
    }
  }
  if (!response.ok) {
    const detail = typeof payload['error_description'] === 'string'
      ? payload['error_description']
      : typeof payload['error'] === 'string'
        ? payload['error']
        : `HTTP ${response.status}`;
    throw new Error(`Could not obtain Google access token (${detail}).`);
  }
  const token = typeof payload['access_token'] === 'string' ? payload['access_token'] : '';
  if (!token) throw new Error('Google token response did not include an access_token.');
  const expiresIn = typeof payload['expires_in'] === 'number' ? payload['expires_in'] : 3600;
  accessTokenCache = {
    cacheKey,
    token,
    expiresAtMs: now + expiresIn * 1000,
  };
  return token;
}

export async function geminiAccessTokenFromCredentialsJson(
  credentialsJson: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const credentials = parseGoogleServiceAccountJson(credentialsJson);
  return fetchGoogleAccessToken(credentials, fetchFn);
}

/** Extract model ids from Generative Language API GET /v1beta/models. */
export function parseGeminiModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const short = name.includes('/') ? name.split('/').pop()! : name;
    if (short.startsWith('gemini-')) names.push(short);
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
