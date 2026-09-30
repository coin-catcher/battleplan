import type {
  CreateAgentInput,
  CreateRunInput,
  CursorAgent,
  CursorClient,
  CursorRun,
} from '../shared/src/cursor-client.js';
import { HttpError } from '../shared/src/errors.js';
import { GENERATE_TASKS_INSTRUCTION } from '../shared/src/prompts.js';

const TASK_LIST = JSON.stringify([
  {
    title: 'Survey the domain',
    prompt: 'Write research notes for the agreed warplan scope.',
    output_type: 'research',
    depends_on: [],
  },
  {
    title: 'Draft the rollout notes',
    prompt: 'Write a short rollout note beside the domain survey.',
    output_type: 'research',
    depends_on: [],
  },
  {
    title: 'Implement the first slice',
    prompt: 'Implement the first code slice described in the research.',
    output_type: 'code',
    depends_on: ['Survey the domain'],
  },
]);

/**
 * In-process Cursor stand-in used by `npm run dev:local` when CURSOR_API_KEY is unset.
 * Runs finish immediately so the Angular app can exercise the Lambda handlers.
 */
export class DemoCursor implements CursorClient {
  private readonly agents = new Map<string, { agent: CursorAgent; runs: CursorRun[] }>();
  private sequence = 0;

  async createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }> {
    const id = `bc-demo-${++this.sequence}`;
    const run = this.finish(id, input.prompt, input.mode === 'agent', input.name);
    const agent: CursorAgent = {
      id,
      name: (input.name ?? input.prompt).trim().slice(0, 48) || 'Untitled warplan',
      status: 'IDLE',
      url: `https://cursor.com/agents/${id}`,
      latestRunId: run.id,
    };
    this.agents.set(id, { agent, runs: [run] });
    return { agent, run };
  }

  async getAgent(agentId: string): Promise<CursorAgent> {
    return this.require(agentId).agent;
  }

  async archiveAgent(agentId: string): Promise<void> {
    this.agents.delete(agentId);
  }

  async createRun(agentId: string, input: CreateRunInput): Promise<CursorRun> {
    const record = this.require(agentId);
    const run = this.finish(agentId, input.text, input.mode !== 'plan', record.agent.name);
    record.runs.unshift(run);
    record.agent.latestRunId = run.id;
    return run;
  }

  async listRuns(agentId: string): Promise<CursorRun[]> {
    return [...this.require(agentId).runs];
  }

  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    const run = this.require(agentId).runs.find((item) => item.id === runId);
    if (!run) throw new HttpError(404, 'Run not found.');
    return run;
  }

  async cancelRun(agentId: string, runId: string): Promise<void> {
    const run = await this.getRun(agentId, runId);
    run.status = 'CANCELLED';
  }

  private require(agentId: string): { agent: CursorAgent; runs: CursorRun[] } {
    const record = this.agents.get(agentId);
    if (!record) throw new HttpError(404, 'Agent not found.');
    return record;
  }

  private finish(agentId: string, text: string, withPullRequest: boolean, name?: string): CursorRun {
    const merging = text.includes('Merge the pull request');
    const run: CursorRun = {
      id: `run-demo-${++this.sequence}`,
      agentId,
      status: 'FINISHED',
      result: merging
        ? 'Merged the pull request.'
        : text.includes(GENERATE_TASKS_INSTRUCTION.slice(0, 40))
          ? TASK_LIST
          : withPullRequest
            ? `Opened a pull request for ${name ?? 'the task'}.`
            : `Here is a first pass.\n\n${text.trim().slice(0, 280)}\n\nI would split this into research notes and a code change. Say when you want the task list.`,
    };
    if (withPullRequest && !merging) {
      run.git = {
        branches: [{
          repoUrl: 'github.com/acme/warplan',
          branch: `cursor/${(name ?? 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'}`,
          prUrl: 'https://github.com/acme/warplan/pull/1',
        }],
      };
    }
    return run;
  }
}
