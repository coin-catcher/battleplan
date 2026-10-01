import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createHandler as createAgentsHandler, handler as agentsHandler } from '../../agents/src/handler.js';
import { createHandler as createChatHandler, handler as chatHandler } from '../../chat/src/handler.js';
import { createHandler as createOutputsHandler, handler as outputsHandler } from '../../outputs/src/handler.js';
import { createHandler as createProjectsHandler, handler as projectsHandler } from '../../projects/src/handler.js';
import { createHandler as createTasksHandler, handler as tasksHandler } from '../../tasks/src/handler.js';
import type { CursorClient, CursorRun, CreateAgentInput, CreateRunInput } from './cursor-client.js';
import { HttpCursorClient } from './cursor-client.js';
import type { Clock } from './ids.js';
import { MemoryRepository } from './memory-repository.js';
import { ChatService } from './chat-service.js';
import { OutputsService } from './outputs-service.js';
import { ProjectsService } from './projects-service.js';
import { TasksService } from './tasks-service.js';
import { assertCanTransition } from './status.js';
import { parseGeneratedTaskList } from './task-list.js';
import { assertAcyclic } from './graph.js';
import { HttpError } from './errors.js';
import { GENERATE_TASKS_INSTRUCTION } from './prompts.js';
import { WARPLAN_PUBLIC_KEY } from './public-key.js';
import { canonicalRequest } from './signature.js';

const privateKey = createPrivateKey(readFileSync(new URL('../../../keys/warplan-private.pem', import.meta.url)));

function clock(): Clock {
  let id = 0;
  let second = 0;
  return {
    newId: () => `id-${++id}`,
    nowIso: () => new Date(Date.UTC(2026, 8, 30, 12, 0, ++second)).toISOString(),
  };
}

class FakeCursor implements CursorClient {
  readonly agents = new Map<string, { name: string; url: string; runs: CursorRun[] }>();
  readonly files = new Map<string, Array<{ path: string; updatedAt: string; body: string }>>();
  archived: string[] = [];
  private sequence = 0;

  async createAgent(input: CreateAgentInput) {
    const id = `bc-${++this.sequence}`;
    const run = this.finish(id, input.prompt, input.mode === 'agent');
    const agent = {
      id,
      name: input.name?.trim() || input.prompt.slice(0, 48),
      status: 'ACTIVE',
      url: `https://cursor.com/agents/${id}`,
      latestRunId: run.id,
    };
    this.agents.set(id, { name: agent.name, url: agent.url, runs: [run] });
    return { agent, run };
  }

  async getAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new HttpError(404, 'missing agent');
    return { id: agentId, name: agent.name, status: 'IDLE', url: agent.url, latestRunId: agent.runs[0]?.id };
  }

  async archiveAgent(agentId: string) {
    this.archived.push(agentId);
  }

  async createRun(agentId: string, input: CreateRunInput) {
    const run = this.finish(agentId, input.text, input.mode === 'agent');
    this.agents.get(agentId)?.runs.unshift(run);
    return run;
  }

  async listRuns(agentId: string) {
    return [...(this.agents.get(agentId)?.runs ?? [])];
  }

  async getRun(agentId: string, runId: string) {
    const run = this.agents.get(agentId)?.runs.find((item) => item.id === runId);
    if (!run) throw new HttpError(404, 'missing run');
    return run;
  }

  async cancelRun() {
    return undefined;
  }

  async listArtifacts(agentId: string) {
    return (this.files.get(agentId) ?? []).map((file) => ({
      path: file.path,
      sizeBytes: Buffer.byteLength(file.body),
      updatedAt: file.updatedAt,
    }));
  }

  async downloadArtifact(agentId: string, path: string) {
    const file = this.files.get(agentId)?.find((item) => item.path === path);
    if (!file) throw new HttpError(404, 'missing artifact');
    return {
      url: `data:text/plain,${encodeURIComponent(file.body)}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
  }

  private finish(agentId: string, text: string, withPullRequest: boolean): CursorRun {
    const id = `run-${++this.sequence}`;
    const taskList = text.includes('ordered list of project tasks');
    const run: CursorRun = {
      id,
      agentId,
      status: 'FINISHED',
      result: taskList
        ? JSON.stringify([
            {
              title: 'Map the domain',
              prompt: 'Write the domain notes.',
              output_type: 'research',
              depends_on: [],
            },
            {
              title: 'Ship the API',
              prompt: 'Implement the API and document the findings.',
              output_type: 'both',
              depends_on: ['Map the domain'],
            },
          ])
        : `Response: ${text.slice(0, 80)}`,
    };
    if (withPullRequest && !text.includes('Merge the pull request')) {
      run.git = {
        branches: [{
          repoUrl: 'github.com/acme/warplan',
          branch: 'cursor/ship-api',
          prUrl: 'https://github.com/acme/warplan/pull/7',
        }],
      };
    }
    if (text.includes('Merge the pull request')) {
      run.result = 'Merged the pull request.';
    }
    return run;
  }
}

function responseBody(result: Awaited<ReturnType<ReturnType<typeof createProjectsHandler>>>): { statusCode: number; body: string } {
  if (!result || typeof result === 'string') {
    throw new Error('Expected an API Gateway result object.');
  }
  return { statusCode: result.statusCode ?? 200, body: result.body ?? '' };
}

function event(
  method: string,
  path: string,
  body?: unknown,
  options?: { unsigned?: boolean; timestamp?: string; tamperBody?: string; query?: string },
): APIGatewayProxyEventV2 {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const timestamp = options?.timestamp ?? String(Date.now());
  const query = options?.query ?? '';
  const target = query ? `${path}?${query}` : path;
  const signature = sign(null, Buffer.from(canonicalRequest(method, target, timestamp, raw)), privateKey).toString('base64');
  const sent = options?.tamperBody ?? raw;
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: query,
    headers: options?.unsigned
      ? {}
      : {
          'x-warplan-timestamp': timestamp,
          'x-warplan-signature': signature,
        },
    requestContext: {
      accountId: '1',
      apiId: 'api',
      domainName: 'example.com',
      domainPrefix: 'example',
      requestId: 'req',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '',
      timeEpoch: 0,
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
    body: sent ? sent : undefined,
  } as APIGatewayProxyEventV2;
}

describe('task rules', () => {
  it('follows the guided status path and allows a manual override', () => {
    expect(() => assertCanTransition('TODO', 'DOING', false)).not.toThrow();
    expect(() => assertCanTransition('DOING', 'REVIEW', false)).not.toThrow();
    expect(() => assertCanTransition('REVIEW', 'DOING', false)).not.toThrow();
    expect(() => assertCanTransition('REVIEW', 'DONE', false)).not.toThrow();
    expect(() => assertCanTransition('TODO', 'DONE', false)).toThrow(HttpError);
    expect(() => assertCanTransition('TODO', 'DONE', true)).not.toThrow();
  });

  it('parses a fenced task list and splits mixed outputs', () => {
    const drafts = parseGeneratedTaskList('```json\n[{"title":"Notes","prompt":"Write notes","output_type":"both","depends_on":[]}]\n```');
    expect(drafts.map((draft) => draft.output_type)).toEqual(['research', 'code']);
    expect(drafts[1].depends_on).toEqual(['Notes (research)']);
  });

  it('rejects a dependency cycle', () => {
    expect(() => assertAcyclic([
      { task_id: 'a', dependencies: ['b'] },
      { task_id: 'b', dependencies: ['a'] },
    ])).toThrow(/cycle/);
  });
});

describe('warplan flow', () => {
  it('creates a project, generates tasks, reviews a pull request, and merges it', async () => {
    const repo = new MemoryRepository();
    const cursor = new FakeCursor();
    const ticks = clock();
    const projects = new ProjectsService(repo, cursor, ticks);
    const tasks = new TasksService(repo, cursor, ticks);
    const chat = new ChatService(repo, cursor, ticks);
    const outputs = new OutputsService(repo, ticks);

    const project = await projects.create({
      initial_prompt: 'Plan the first warplan release.',
      repo_url: 'https://github.com/acme/warplan',
      starting_ref: 'main',
    });
    expect(project.title).toBe('Plan the first warplan release.');
    expect(project.cursor_chat_link).toBe(`https://cursor.com/agents/${project.cursor_agent_id}`);

    const history = await chat.listProjectMessages(project.project_id);
    expect(history.messages.map((message) => message.role)).toEqual(['user', 'assistant']);

    await projects.updateTitle(project.project_id, 'Release warplan');
    expect((await projects.get(project.project_id)).title).toBe('Release warplan');

    const instruction = await chat.generateTasks(project.project_id);
    expect(instruction.content).toBe(GENERATE_TASKS_INSTRUCTION);
    const afterGenerate = await chat.listProjectMessages(project.project_id);
    const generated = afterGenerate.messages.filter((message) => message.intent === 'generate_tasks' && message.role === 'assistant').at(-1);
    expect(generated).toBeTruthy();
    const created = await tasks.createBatch(project.project_id, parseGeneratedTaskList(generated!.content));
    expect(created.map((task) => task.output_type)).toEqual(['research', 'research', 'code']);
    expect(created[2].dependencies).toContain(created[1].task_id);

    await expect(tasks.transition(project.project_id, created[2].task_id, 'DOING', false)).rejects.toThrow(/Dependencies/);
    const research = await tasks.transition(project.project_id, created[0].task_id, 'DOING', false);
    expect(research.status).toBe('DOING');
    expect(research.cursor_agent_id).toBeTruthy();

    const reviewed = await chat.listTaskMessages(research.task_id);
    expect(reviewed.task.status).toBe('REVIEW');
    const researchOutput = await outputs.getResearch(research.task_id);
    expect(researchOutput?.path).toBe(`research/${project.project_id}/${research.task_id}/`);
    expect(researchOutput?.pr_link).toContain('/pull/7');

    const feedback = await chat.sendTaskMessage(research.task_id, 'Add a sequence diagram.');
    expect(feedback.intent).toBe('feedback');
    expect((await tasks.get(project.project_id, research.task_id)).status).toBe('DOING');
    const backToReview = await chat.listTaskMessages(research.task_id);
    expect(backToReview.task.status).toBe('REVIEW');

    const merging = await chat.approve(research.task_id);
    expect(merging.status).toBe('DOING');
    expect(merging.pending_action).toBe('merge');
    const done = await chat.listTaskMessages(research.task_id);
    expect(done.task.status).toBe('DONE');
    expect(done.task.pending_action).toBeUndefined();

    const ordered = await tasks.reorder(project.project_id, [...created].reverse().map((task) => task.task_id));
    expect(ordered[0].task_id).toBe(created[2].task_id);

    const added = await tasks.createOne(project.project_id, { depends_on: created[0].task_id });
    expect(added.title).toBe('New task');
    expect(added.dependencies).toEqual([created[0].task_id]);

    await tasks.remove(project.project_id, created[2].task_id);
    expect(await repo.getTask(created[2].task_id)).toBeNull();
    expect((await tasks.get(project.project_id, added.task_id)).dependencies).toEqual([created[0].task_id]);
  });

  it('retrieves a markdown artifact written by the Cursor agent', async () => {
    const repo = new MemoryRepository();
    const cursor = new FakeCursor();
    const chat = new ChatService(repo, cursor, clock());
    const projects = new ProjectsService(repo, cursor, clock());
    const project = await projects.create({ initial_prompt: 'Analyze the problem space.' });
    const agentId = project.cursor_agent_id!;
    const run = cursor.agents.get(agentId)!.runs[0];
    run.result = '';
    cursor.files.set(agentId, [{
      path: 'artifacts/analysis.md',
      updatedAt: '2026-09-30T12:00:00.000Z',
      body: '# Analysis\n\nThe problem space is wider than the first prompt.',
    }]);

    const page = await chat.listProjectMessages(project.project_id);
    expect(page.messages.some((message) => message.role === 'assistant' && message.run_id === run.id)).toBe(true);
    expect(page.artifacts).toHaveLength(1);
    expect(page.artifacts[0].name).toBe('analysis.md');
    expect(page.artifacts[0].content_type).toBe('text');
    expect(page.artifacts[0].text).toContain('problem space');

    const again = await chat.listProjectMessages(project.project_id);
    expect(again.artifacts[0].text).toContain('problem space');
  });
});

describe('request signatures', () => {
  it('embeds the repository public key', () => {
    const pem = readFileSync(new URL('../../../keys/warplan-public.pem', import.meta.url), 'utf8');
    expect(WARPLAN_PUBLIC_KEY.trim()).toBe(pem.trim());
  });

  const handlers: Array<[string, APIGatewayProxyHandlerV2]> = [
    ['projects', createProjectsHandler({ repo: new MemoryRepository(), cursor: new FakeCursor() })],
    ['tasks', createTasksHandler({ repo: new MemoryRepository(), cursor: new FakeCursor() })],
    ['outputs', createOutputsHandler({ repo: new MemoryRepository(), cursor: new FakeCursor() })],
    ['chat', createChatHandler({ repo: new MemoryRepository(), cursor: new FakeCursor() })],
    ['agents', createAgentsHandler({ repo: new MemoryRepository(), cursor: new FakeCursor() })],
  ];

  it.each(handlers)('rejects an unsigned %s request', async (_name, handle) => {
    const result = responseBody(await handle(event('GET', '/projects', undefined, { unsigned: true }), {} as never, () => undefined));
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Request signature is required.');
  });

  it.each([projectsHandler, tasksHandler, outputsHandler, chatHandler, agentsHandler])(
    'rejects an unsigned lambda entrypoint',
    async (handle) => {
      const result = responseBody(await handle(event('GET', '/projects', undefined, { unsigned: true })));
      expect(result.statusCode).toBe(401);
    },
  );

  it('rejects a tampered body and an expired timestamp', async () => {
    const projects = createProjectsHandler({ repo: new MemoryRepository(), cursor: new FakeCursor() });
    const tampered = responseBody(await projects(event('POST', '/projects', {
      initial_prompt: 'Sketch the navigation.',
    }, { tamperBody: '{"initial_prompt":"changed"}' }), {} as never, () => undefined));
    expect(tampered.statusCode).toBe(401);
    expect(JSON.parse(tampered.body).error).toBe('Request signature is invalid.');

    const expired = responseBody(await projects(event('GET', '/projects', undefined, {
      timestamp: String(Date.now() - 6 * 60 * 1000),
    }), {} as never, () => undefined));
    expect(expired.statusCode).toBe(401);
    expect(JSON.parse(expired.body).error).toBe('Request signature has expired.');
  });
});

describe('lambda routes', () => {
  it('serves project, task, chat, and output routes', async () => {
    const repo = new MemoryRepository();
    const cursor = new FakeCursor();
    const projects = createProjectsHandler({ repo, cursor });
    const created = responseBody(await projects(event('POST', '/projects', {
      initial_prompt: 'Sketch the navigation.',
      repo_url: 'https://github.com/acme/warplan',
    }), {} as never, () => undefined));
    const project = JSON.parse(created.body) as { project_id: string };
    expect(created.statusCode).toBe(201);

    const chat = createChatHandler({ repo, cursor });
    const generated = responseBody(await chat(event('POST', `/projects/${project.project_id}/messages/generate-tasks`), {} as never, () => undefined));
    expect(generated.statusCode).toBe(202);
    const messages = responseBody(await chat(event('GET', `/projects/${project.project_id}/messages`), {} as never, () => undefined));
    const body = JSON.parse(messages.body) as { messages: Array<{ role: string; intent?: string; content: string }> };
    const assistant = body.messages.find((message) => message.role === 'assistant' && message.intent === 'generate_tasks');

    const tasks = createTasksHandler({ repo, cursor });
    const saved = responseBody(await tasks(event('POST', `/projects/${project.project_id}/tasks`, {
      tasks: parseGeneratedTaskList(assistant!.content),
    }), {} as never, () => undefined));
    expect(saved.statusCode).toBe(201);
    const taskList = JSON.parse(saved.body) as { tasks: Array<{ task_id: string }> };

    const started = responseBody(await tasks(event('POST', `/projects/${project.project_id}/tasks/${taskList.tasks[0].task_id}/transition`, {
      status: 'DOING',
    }), {} as never, () => undefined));
    expect(JSON.parse(started.body).status).toBe('DOING');

    const taskChat = createChatHandler({ repo, cursor });
    await taskChat(event('GET', `/tasks/${taskList.tasks[0].task_id}/messages`), {} as never, () => undefined);
    const outputs = createOutputsHandler({ repo, cursor });
    const output = responseBody(await outputs(event('GET', `/tasks/${taskList.tasks[0].task_id}/outputs/research`), {} as never, () => undefined));
    expect(output.statusCode).toBe(200);

    const missing = responseBody(await projects(event('GET', '/missing'), {} as never, () => undefined));
    expect(missing.statusCode).toBe(404);
  });
});

describe('cursor client', () => {
  it('launches a v1 agent with basic auth and maps the run', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({
        agent: {
          id: 'bc-1',
          name: 'Add a plan',
          status: 'ACTIVE',
          url: 'https://cursor.com/agents/bc-1',
          latestRunId: 'run-1',
        },
        run: { id: 'run-1', agentId: 'bc-1', status: 'CREATING' },
      }), { status: 200 });
    };
    const client = new HttpCursorClient({ apiKey: 'test-key', fetchImpl });
    const created = await client.createAgent({
      prompt: 'Plan the work',
      mode: 'plan',
      repoUrl: 'https://github.com/acme/warplan',
      startingRef: 'develop',
      autoCreatePr: false,
    });
    expect(created.agent.url).toContain('/agents/bc-1');
    expect(seen[0].url).toBe('https://api.cursor.com/v1/agents');
    expect(seen[0].init?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('test-key:').toString('base64')}`,
    });
    const body = JSON.parse(String(seen[0].init?.body)) as { mode: string; repos: Array<{ startingRef: string }> };
    expect(body.mode).toBe('plan');
    expect(body.repos[0].startingRef).toBe('develop');
  });
});
