import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { HttpError } from './errors.js';
import { BATTLEPLAN_PUBLIC_KEY } from './public-key.js';

/** Request-signature canonical form verified by the HTTP API. */
export const SIGNATURE_VERSION = 'v1';
export const MAX_SIGNATURE_SKEW_MS = 5 * 60 * 1000;

export function canonicalRequest(method: string, target: string, timestamp: string, rawBody: string): string {
  return `${SIGNATURE_VERSION}\n${timestamp}\n${method.toUpperCase()}\n${target}\n${rawBody}`;
}

export function requestTarget(event: Pick<APIGatewayProxyEventV2, 'rawPath' | 'rawQueryString'>): string {
  const path = event.rawPath || '/';
  const query = event.rawQueryString ?? '';
  return query ? `${path}?${query}` : path;
}

export function rawRequestBody(event: Pick<APIGatewayProxyEventV2, 'body' | 'isBase64Encoded'>): string {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

export function assertSignedRequest(event: APIGatewayProxyEventV2, now = Date.now()): void {
  const timestamp = header(event, 'x-battleplan-timestamp');
  const signature = header(event, 'x-battleplan-signature');
  if (!timestamp || !signature) {
    throw new HttpError(401, 'Request signature is required.');
  }
  if (!/^\d+$/.test(timestamp)) {
    throw new HttpError(401, 'Request signature is invalid.');
  }
  if (Math.abs(now - Number(timestamp)) > MAX_SIGNATURE_SKEW_MS) {
    throw new HttpError(401, 'Request signature has expired.');
  }
  const message = canonicalRequest(
    event.requestContext.http.method,
    requestTarget(event),
    timestamp,
    rawRequestBody(event),
  );
  let valid = false;
  try {
    valid = verify(null, Buffer.from(message, 'utf8'), publicKey(), Buffer.from(signature, 'base64'));
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new HttpError(401, 'Request signature is invalid.');
  }
}

function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === wanted && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

let cachedKey: KeyObject | undefined;

function publicKey(): KeyObject {
  cachedKey ??= createPublicKey(BATTLEPLAN_PUBLIC_KEY);
  return cachedKey;
}
