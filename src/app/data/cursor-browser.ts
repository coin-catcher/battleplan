export interface CursorAgent {
  id: string;
  name: string;
  status: string;
  url: string;
  latestRunId?: string;
}

export interface CursorGitBranch {
  repoUrl: string;
  branch?: string;
  prUrl?: string;
}

export interface CursorRun {
  id: string;
  agentId: string;
  status: string;
  result?: string;
  git?: { branches: CursorGitBranch[] };
}

export interface CursorArtifact {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface ArtifactDownload {
  url: string;
  expiresAt: string;
}

export interface CreateAgentInput {
  prompt: string;
  name?: string;
  mode?: 'agent' | 'plan';
  repoUrl?: string;
  startingRef?: string;
  autoCreatePr?: boolean;
  prUrl?: string;
}

export interface CursorClient {
  createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }>;
  archiveAgent(agentId: string): Promise<void>;
  createRun(agentId: string, input: { text: string; mode?: 'agent' | 'plan' }): Promise<CursorRun>;
  listRuns(agentId: string): Promise<CursorRun[]>;
  getRun(agentId: string, runId: string): Promise<CursorRun>;
  streamRunText(agentId: string, runId: string): Promise<string | undefined>;
  listArtifacts(agentId: string): Promise<CursorArtifact[]>;
  downloadArtifact(agentId: string, path: string): Promise<ArtifactDownload>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function mapAgent(value: unknown): CursorAgent {
  const record = asRecord(value);
  return {
    id: String(record['id'] ?? ''),
    name: String(record['name'] ?? ''),
    status: String(record['status'] ?? ''),
    url: String(record['url'] ?? ''),
    latestRunId: typeof record['latestRunId'] === 'string' ? record['latestRunId'] : undefined,
  };
}

function mapRun(value: unknown): CursorRun {
  const record = asRecord(value);
  const git = asRecord(record['git']);
  const branches = Array.isArray(git['branches']) ? git['branches'].map((item) => {
    const branch = asRecord(item);
    return {
      repoUrl: String(branch['repoUrl'] ?? ''),
      branch: typeof branch['branch'] === 'string' ? branch['branch'] : undefined,
      prUrl: typeof branch['prUrl'] === 'string' ? branch['prUrl'] : undefined,
    };
  }) : undefined;
  return {
    id: String(record['id'] ?? ''),
    agentId: String(record['agentId'] ?? ''),
    status: String(record['status'] ?? ''),
    result: typeof record['result'] === 'string' ? record['result'] : undefined,
    git: branches ? { branches } : undefined,
  };
}

export function normalizeRepoUrl(repoUrl: string): string {
  if (/^https?:\/\//i.test(repoUrl)) return repoUrl.replace(/\/$/, '');
  return `https://${repoUrl.replace(/\/$/, '')}`;
}

export class BrowserCursor implements CursorClient {
  constructor(private readonly apiKey: () => string) {}

  async createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }> {
    const body: Record<string, unknown> = {
      prompt: { text: input.prompt },
      mode: input.mode ?? 'agent',
      autoCreatePR: input.autoCreatePr ?? false,
    };
    if (input.name) body['name'] = input.name.slice(0, 100);
    if (input.repoUrl) {
      const repo: Record<string, string> = { url: input.repoUrl };
      if (input.startingRef) repo['startingRef'] = input.startingRef;
      if (input.prUrl) repo['prUrl'] = input.prUrl;
      body['repos'] = [repo];
    }
    const payload = await this.request<Record<string, unknown>>('POST', '/v1/agents', body);
    return { agent: mapAgent(payload['agent']), run: mapRun(payload['run']) };
  }

  async archiveAgent(agentId: string): Promise<void> {
    await this.request('POST', `/v1/agents/${encodeURIComponent(agentId)}/archive`);
  }

  async createRun(agentId: string, input: { text: string; mode?: 'agent' | 'plan' }): Promise<CursorRun> {
    const body: Record<string, unknown> = { prompt: { text: input.text } };
    if (input.mode) body['mode'] = input.mode;
    const payload = await this.request<Record<string, unknown>>(
      'POST',
      `/v1/agents/${encodeURIComponent(agentId)}/runs`,
      body,
    );
    return mapRun(payload['run'] ?? payload);
  }

  async listRuns(agentId: string): Promise<CursorRun[]> {
    const payload = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/agents/${encodeURIComponent(agentId)}/runs?limit=20`,
    );
    const items = Array.isArray(payload['items']) ? payload['items'] : [];
    return items.map((item) => mapRun(item));
  }

  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    return mapRun(await this.request(
      'GET',
      `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    ));
  }

  async streamRunText(agentId: string, runId: string): Promise<string | undefined> {
    const apiKey = this.apiKey().trim();
    if (!apiKey) return undefined;
    let response: Response;
    try {
      response = await fetch(
        `https://api.cursor.com/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`,
        {
          headers: {
            authorization: `Basic ${btoa(`${apiKey}:`)}`,
            accept: 'text/event-stream',
          },
        },
      );
    } catch {
      return undefined;
    }
    if (!response.ok) return undefined;
    const body = await response.text();
    let assistant = '';
    let resultText = '';
    for (const chunk of body.split('\n\n')) {
      const lines = chunk.split('\n');
      let event = '';
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (!line.startsWith('data:')) continue;
        try {
          const data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          if (event === 'assistant' && typeof data['text'] === 'string') assistant += data['text'];
          if (event === 'result' && typeof data['text'] === 'string') resultText = data['text'];
        } catch {
          continue;
        }
      }
    }
    const combined = resultText.trim() || assistant.trim();
    return combined || undefined;
  }

  async listArtifacts(agentId: string): Promise<CursorArtifact[]> {
    const payload = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/agents/${encodeURIComponent(agentId)}/artifacts`,
    );
    const items = Array.isArray(payload['items']) ? payload['items'] : [];
    return items.map((item) => {
      const record = asRecord(item);
      return {
        path: String(record['path'] ?? ''),
        sizeBytes: Number(record['sizeBytes'] ?? 0),
        updatedAt: String(record['updatedAt'] ?? ''),
      };
    }).filter((item) => item.path.length > 0);
  }

  async downloadArtifact(agentId: string, path: string): Promise<ArtifactDownload> {
    const payload = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/agents/${encodeURIComponent(agentId)}/artifacts/download?path=${encodeURIComponent(path)}`,
    );
    return {
      url: String(payload['url'] ?? ''),
      expiresAt: String(payload['expiresAt'] ?? ''),
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const apiKey = this.apiKey().trim();
    if (!apiKey) throw new Error('Save a Cursor API key in this browser before talking to Cursor.');
    let response: Response;
    try {
      response = await fetch(`https://api.cursor.com${path}`, {
        method,
        headers: {
          authorization: `Basic ${btoa(`${apiKey}:`)}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('The browser could not reach the Cursor API.');
    }
    const text = await response.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { message: text };
      }
    }
    if (!response.ok) {
      const record = asRecord(parsed);
      const message = typeof record['message'] === 'string' && record['message']
        ? record['message']
        : text || response.statusText;
      throw new Error(`Cursor API error: ${message}`);
    }
    return parsed as T;
  }
}
