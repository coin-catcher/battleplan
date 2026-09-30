import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHandler as createAgentsHandler } from '../agents/src/handler.js';
import { createHandler as createChatHandler } from '../chat/src/handler.js';
import { HttpCursorClient, type CursorClient } from '../shared/src/cursor-client.js';
import { MemoryRepository } from '../shared/src/memory-repository.js';
import { createHandler as createOutputsHandler } from '../outputs/src/handler.js';
import { createHandler as createProjectsHandler } from '../projects/src/handler.js';
import { createHandler as createTasksHandler } from '../tasks/src/handler.js';
import { DemoCursor } from './demo-cursor.js';

const port = Number(process.env.WARPLAN_LOCAL_PORT ?? 8787);
const repo = new MemoryRepository();
const cursor: CursorClient = process.env.CURSOR_API_KEY
  ? new HttpCursorClient({ apiKey: process.env.CURSOR_API_KEY, baseUrl: process.env.CURSOR_API_BASE })
  : new DemoCursor();
const deps = { repo, cursor };
const handlers = [
  createProjectsHandler(deps),
  createTasksHandler(deps),
  createOutputsHandler(deps),
  createChatHandler(deps),
  createAgentsHandler(deps),
];

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify({ error: 'Internal error' }));
  }
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }
  const body = await readBody(request);
  const event = {
    version: '2.0',
    routeKey: `${request.method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.searchParams.toString(),
    headers: incomingHeaders(request),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: 'local',
      routeKey: `${request.method} ${url.pathname}`,
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      http: {
        method: request.method ?? 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: request.headers['user-agent'] ?? 'local',
      },
    },
    isBase64Encoded: false,
    body: body || undefined,
  };

  for (const handle of handlers) {
    const raw = await handle(event as never, {} as never, () => undefined);
    if (!raw || typeof raw === 'string') continue;
    const payload = raw.body ? JSON.parse(raw.body) as { error?: string } : {};
    const routeMiss = raw.statusCode === 404 && (payload.error ?? '').startsWith('No route');
    if (routeMiss) continue;
    const headers = { ...corsHeaders(), ...(raw.headers ?? {}) };
    response.writeHead(raw.statusCode ?? 200, headers as never);
    response.end(raw.body ?? '');
    return;
  }

  response.writeHead(404, { ...corsHeaders(), 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: `No route for ${request.method} ${url.pathname}` }));
}

function incomingHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value == null) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
  }
  if (!headers['content-type']) headers['content-type'] = 'application/json';
  return headers;
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-warplan-timestamp,x-warplan-signature',
  };
}

server.listen(port, () => {
  const mode = process.env.CURSOR_API_KEY ? 'Cursor API' : 'demo Cursor agent';
  console.log(`warplan local API on http://localhost:${port} (${mode})`);
});
