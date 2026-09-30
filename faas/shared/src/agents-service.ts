import type { CreateRunInput, CursorAgent, CursorClient, CursorRun } from './cursor-client.js';
import { HttpError } from './errors.js';
import { systemClock, type Clock } from './ids.js';
import type { WarplanRepository } from './repository.js';

export class AgentsService {
  constructor(
    private readonly repo: WarplanRepository,
    private readonly cursor: CursorClient,
    private readonly clock: Clock = systemClock,
  ) {}

  getAgent(agentId: string): Promise<CursorAgent> {
    return this.cursor.getAgent(agentId);
  }

  listRuns(agentId: string): Promise<CursorRun[]> {
    return this.cursor.listRuns(agentId);
  }

  async createRun(agentId: string, text: string, mode?: CreateRunInput['mode']): Promise<CursorRun> {
    const content = text.trim();
    if (!content) throw new HttpError(400, 'prompt is required.');
    const run = await this.cursor.createRun(agentId, { text: content, mode });
    const project = await this.repo.findProjectByAgent(agentId);
    const task = project ? null : await this.repo.findTaskByAgent(agentId);
    const timestamp = this.clock.nowIso();
    if (project) {
      project.latest_run_id = run.id;
      project.updated_at = timestamp;
      await this.repo.saveProject(project);
      await this.repo.saveMessage({
        message_id: this.clock.newId(),
        scope: 'project',
        project_id: project.project_id,
        role: 'user',
        content,
        created_at: timestamp,
        run_id: run.id,
        intent: 'chat',
      });
    } else if (task) {
      task.latest_run_id = run.id;
      task.updated_at = timestamp;
      await this.repo.saveTask(task);
      await this.repo.saveMessage({
        message_id: this.clock.newId(),
        scope: 'task',
        project_id: task.project_id,
        task_id: task.task_id,
        role: 'user',
        content,
        created_at: timestamp,
        run_id: run.id,
        intent: 'chat',
      });
    }
    return run;
  }

  cancelRun(agentId: string, runId: string): Promise<void> {
    return this.cursor.cancelRun(agentId, runId);
  }
}
