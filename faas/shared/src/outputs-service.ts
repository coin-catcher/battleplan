import type { TaskCodeOutput, TaskResearchOutput } from './domain.js';
import { researchPath } from './domain.js';
import { HttpError } from './errors.js';
import { systemClock, type Clock } from './ids.js';
import type { WarplanRepository } from './repository.js';
import { assertCanTransition } from './status.js';

function requiredFields(output: Partial<TaskCodeOutput>, fields: Array<keyof TaskCodeOutput>): void {
  for (const field of fields) {
    const value = output[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw new HttpError(400, `${field} is required.`);
    }
  }
}

export class OutputsService {
  constructor(
    private readonly repo: WarplanRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async getCode(taskId: string): Promise<TaskCodeOutput | null> {
    await this.requireTask(taskId, 'code');
    return this.repo.getCodeOutput(taskId);
  }

  async putCode(taskId: string, input: Partial<TaskCodeOutput>): Promise<TaskCodeOutput> {
    const task = await this.requireTask(taskId, 'code');
    requiredFields(input, ['repo', 'branch', 'pr_message', 'pr_link']);
    const output: TaskCodeOutput = {
      task_id: taskId,
      repo: input.repo!.trim(),
      branch: input.branch!.trim(),
      pr_message: input.pr_message!.trim(),
      pr_link: input.pr_link!.trim(),
    };
    await this.repo.saveCodeOutput(output);
    await this.markReview(task.project_id, taskId);
    return output;
  }

  async getResearch(taskId: string): Promise<TaskResearchOutput | null> {
    await this.requireTask(taskId, 'research');
    return this.repo.getResearchOutput(taskId);
  }

  async putResearch(taskId: string, input: Partial<TaskResearchOutput>): Promise<TaskResearchOutput> {
    const task = await this.requireTask(taskId, 'research');
    requiredFields(input, ['repo', 'branch', 'pr_message', 'pr_link']);
    const output: TaskResearchOutput = {
      task_id: taskId,
      repo: input.repo!.trim(),
      branch: input.branch!.trim(),
      pr_message: input.pr_message!.trim(),
      pr_link: input.pr_link!.trim(),
      path: input.path?.trim() || researchPath(task.project_id, taskId),
    };
    await this.repo.saveResearchOutput(output);
    await this.markReview(task.project_id, taskId);
    return output;
  }

  private async markReview(projectId: string, taskId: string): Promise<void> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.project_id !== projectId || task.status !== 'DOING') return;
    assertCanTransition(task.status, 'REVIEW', false);
    task.status = 'REVIEW';
    task.updated_at = this.clock.nowIso();
    await this.repo.saveTask(task);
  }

  private async requireTask(taskId: string, outputType: 'code' | 'research') {
    const task = await this.repo.getTask(taskId);
    if (!task) throw new HttpError(404, 'Task not found.');
    if (task.output_type !== outputType) {
      throw new HttpError(400, `This task produces ${task.output_type} output.`);
    }
    return task;
  }
}
