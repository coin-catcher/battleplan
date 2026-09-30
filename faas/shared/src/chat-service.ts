import type { CursorClient, CursorRun } from './cursor-client.js';
import { normalizeRepoUrl } from './cursor-client.js';
import type { ChatMessage, MessageIntent, ProjectTask } from './domain.js';
import { researchPath } from './domain.js';
import { HttpError } from './errors.js';
import { systemClock, type Clock } from './ids.js';
import { feedbackPrompt, GENERATE_TASKS_INSTRUCTION, mergeApprovalPrompt } from './prompts.js';
import type { WarplanRepository } from './repository.js';
import { assertCanTransition } from './status.js';

export class ChatService {
  constructor(
    private readonly repo: WarplanRepository,
    private readonly cursor: CursorClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    const project = await this.requireProject(projectId);
    if (project.cursor_agent_id) {
      await this.importFinishedRuns(project.cursor_agent_id, { scope: 'project', projectId });
    }
    return this.repo.listProjectMessages(projectId);
  }

  async sendProjectMessage(projectId: string, text: string): Promise<ChatMessage> {
    return this.dispatchProject(projectId, text, 'chat');
  }

  async generateTasks(projectId: string): Promise<ChatMessage> {
    return this.dispatchProject(projectId, GENERATE_TASKS_INSTRUCTION, 'generate_tasks');
  }

  async listTaskMessages(taskId: string): Promise<{ messages: ChatMessage[]; task: ProjectTask }> {
    const task = await this.requireTask(taskId);
    if (task.cursor_agent_id) {
      await this.importFinishedRuns(task.cursor_agent_id, {
        scope: 'task',
        projectId: task.project_id,
        taskId,
      });
    }
    const updated = await this.repo.getTask(taskId);
    return {
      messages: await this.repo.listTaskMessages(taskId),
      task: updated ?? task,
    };
  }

  async sendTaskMessage(taskId: string, text: string): Promise<ChatMessage> {
    const task = await this.requireTask(taskId);
    const feedback = text.trim();
    if (!feedback) throw new HttpError(400, 'message is required.');
    if (!task.cursor_agent_id) throw new HttpError(409, 'Start the task before sending feedback.');
    if (task.status === 'REVIEW') {
      assertCanTransition('REVIEW', 'DOING', false);
      task.status = 'DOING';
      task.pending_action = undefined;
    }
    const run = await this.cursor.createRun(task.cursor_agent_id, {
      text: feedbackPrompt(task, feedback),
      mode: 'agent',
    });
    task.latest_run_id = run.id;
    task.updated_at = this.clock.nowIso();
    await this.repo.saveTask(task);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: feedback,
      run_id: run.id,
      intent: 'feedback',
    });
  }

  async approve(taskId: string): Promise<ProjectTask> {
    const task = await this.requireTask(taskId);
    if (task.status !== 'REVIEW') {
      throw new HttpError(409, 'Only a task in REVIEW can be approved.');
    }
    if (!task.cursor_agent_id) throw new HttpError(409, 'This task has no Cursor agent.');
    const output = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    if (!output?.pr_link) throw new HttpError(409, 'Record a pull request before approving the task.');
    assertCanTransition('REVIEW', 'DOING', false);
    const run = await this.cursor.createRun(task.cursor_agent_id, {
      text: mergeApprovalPrompt(task, output.pr_link),
      mode: 'agent',
    });
    task.status = 'DOING';
    task.pending_action = 'merge';
    task.latest_run_id = run.id;
    task.updated_at = this.clock.nowIso();
    await this.repo.saveTask(task);
    await this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: 'Approved. Merge the pull request.',
      run_id: run.id,
      intent: 'approve',
    });
    return task;
  }

  private async dispatchProject(projectId: string, text: string, intent: MessageIntent): Promise<ChatMessage> {
    const project = await this.requireProject(projectId);
    const content = text.trim();
    if (!content) throw new HttpError(400, 'message is required.');
    if (!project.cursor_agent_id) throw new HttpError(409, 'This project is not linked to a Cursor agent.');
    const run = await this.cursor.createRun(project.cursor_agent_id, { text: content, mode: 'plan' });
    project.latest_run_id = run.id;
    project.updated_at = this.clock.nowIso();
    await this.repo.saveProject(project);
    return this.record({
      scope: 'project',
      project_id: projectId,
      role: 'user',
      content,
      run_id: run.id,
      intent,
    });
  }

  private async importFinishedRuns(
    agentId: string,
    target: { scope: 'project'; projectId: string } | { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    const existing = target.scope === 'project'
      ? await this.repo.listProjectMessages(target.projectId)
      : await this.repo.listTaskMessages(target.taskId);
    const runs = await this.cursor.listRuns(agentId);
    for (const summary of [...runs].reverse()) {
      const run = summary.result ? summary : await this.cursor.getRun(agentId, summary.id);
      if (run.status !== 'FINISHED' || !run.result) continue;
      if (!existing.some((message) => message.run_id === run.id && message.role === 'assistant')) {
        const user = existing.find((message) => message.run_id === run.id && message.role === 'user');
        const saved = await this.record({
          scope: target.scope,
          project_id: target.projectId,
          task_id: target.scope === 'task' ? target.taskId : undefined,
          role: 'assistant',
          content: run.result,
          run_id: run.id,
          intent: user?.intent ?? 'chat',
        });
        existing.push(saved);
      }
      if (target.scope === 'task') await this.applyTaskRun(target.taskId, run);
    }
  }

  private async applyTaskRun(taskId: string, run: CursorRun): Promise<void> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.latest_run_id !== run.id || run.status !== 'FINISHED') return;
    if (task.pending_action === 'merge') {
      task.status = 'DONE';
      task.pending_action = undefined;
      task.updated_at = this.clock.nowIso();
      await this.repo.saveTask(task);
      return;
    }
    const branch = run.git?.branches.find((item) => item.prUrl && item.branch);
    if (!branch?.prUrl || !branch.branch) return;
    const shared = {
      task_id: task.task_id,
      repo: normalizeRepoUrl(branch.repoUrl),
      branch: branch.branch,
      pr_message: (run.result ?? task.title).slice(0, 500),
      pr_link: branch.prUrl,
    };
    if (task.output_type === 'code') {
      await this.repo.saveCodeOutput(shared);
    } else {
      await this.repo.saveResearchOutput({
        ...shared,
        path: researchPath(task.project_id, task.task_id),
      });
    }
    if (task.status === 'DOING') {
      assertCanTransition('DOING', 'REVIEW', false);
      task.status = 'REVIEW';
      task.updated_at = this.clock.nowIso();
      await this.repo.saveTask(task);
    }
  }

  private async record(message: Omit<ChatMessage, 'message_id' | 'created_at'>): Promise<ChatMessage> {
    const saved: ChatMessage = {
      ...message,
      message_id: this.clock.newId(),
      created_at: this.clock.nowIso(),
    };
    await this.repo.saveMessage(saved);
    return saved;
  }

  private async requireProject(projectId: string) {
    const project = await this.repo.getProject(projectId);
    if (!project) throw new HttpError(404, 'Project not found.');
    return project;
  }

  private async requireTask(taskId: string): Promise<ProjectTask> {
    const task = await this.repo.getTask(taskId);
    if (!task) throw new HttpError(404, 'Task not found.');
    return task;
  }
}
