import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createHandler as createProjectsHandler } from '../../projects/src/handler.js';
import { createHandler as createTasksHandler } from '../../tasks/src/handler.js';
import { createHandler as createChatHandler } from '../../chat/src/handler.js';
import { createHandler as createOutputsHandler } from '../../outputs/src/handler.js';
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

function event(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
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
    body: body === undefined ? undefined : JSON.stringify(body),
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
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant']);

    await projects.updateTitle(project.project_id, 'Release warplan');
    expect((await projects.get(project.project_id)).title).toBe('Release warplan');

    const instruction = await chat.generateTasks(project.project_id);
    expect(instruction.content).toBe(GENERATE_TASKS_INSTRUCTION);
    const afterGenerate = await chat.listProjectMessages(project.project_id);
    const generated = afterGenerate.filter((message) => message.intent === 'generate_tasks' && message.role === 'assistant').at(-1);
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
    expect(researchOutput.path).toBe(`research/${project.project_id}/${research.task_id}/`);
    expect(researchOutput.pr_link).toContain('/pull/7');

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

    await tasks.remove(project.project_id, created[2].task_id);
    expect(await repo.getTask(created[2].task_id)).toBeNull();
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
