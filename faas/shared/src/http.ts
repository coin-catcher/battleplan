import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { HttpError } from './errors.js';

export interface HttpRequest {
  method: string;
  path: string;
  body: unknown;
  query: Record<string, string>;
}

export interface HttpResult {
  statusCode: number;
  body?: unknown;
}

export interface Route {
  method: string;
  path: string;
  handler: (request: HttpRequest, params: Record<string, string>) => Promise<HttpResult>;
}

export function jsonBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string.`);
  return value.trim();
}

function decodeBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

export function matchPath(template: string, path: string): Record<string, string> | null {
  const expected = template.split('/').filter(Boolean);
  const actual = path.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const token = expected[index];
    const value = actual[index];
    if (token.startsWith('{') && token.endsWith('}')) {
      params[token.slice(1, -1)] = decodeURIComponent(value);
    } else if (token !== value) {
      return null;
    }
  }
  return params;
}

export async function dispatch(event: APIGatewayProxyEventV2, routes: Route[]): Promise<APIGatewayProxyResultV2> {
  try {
    const request: HttpRequest = {
      method: event.requestContext.http.method.toUpperCase(),
      path: event.rawPath || '/',
      body: decodeBody(event),
      query: Object.fromEntries(
        Object.entries(event.queryStringParameters ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ),
    };
    let found: { route: Route; params: Record<string, string> } | undefined;
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchPath(route.path, request.path);
      if (params) {
        found = { route, params };
        break;
      }
    }
    if (!found) {
      return respond(404, { error: `No route for ${request.method} ${request.path}` });
    }
    const result = await found.route.handler(request, found.params);
    return respond(result.statusCode, result.body ?? {});
  } catch (error) {
    if (error instanceof HttpError) {
      return respond(error.status, { error: error.message });
    }
    console.error(error);
    return respond(500, { error: 'Internal error' });
  }
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(body),
  };
}
