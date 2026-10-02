import type { ArtifactDownload, CursorArtifact, CursorClient, CursorRun } from './cursor-client.js';
import { normalizeRepoUrl } from './cursor-client.js';
import type { ArtifactKind, ChatArtifact, ChatMessage, MessageIntent, ProjectTask } from './domain.js';
import { researchPath } from './domain.js';
import { HttpError } from './errors.js';
import { systemClock, type Clock } from './ids.js';
import { feedbackPrompt, GENERATE_TASKS_INSTRUCTION, mergeApprovalPrompt } from './prompts.js';
import type { BattleplanRepository } from './repository.js';
import { assertCanTransition } from './status.js';

const TERMINAL_RUN = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED']);
const TEXT_ARTIFACT = /\.(md|markdown|txt|json|csv|ya?ml|html|log|xml|tsv|rst)$/i;
const IMAGE_ARTIFACT = /\.(png|jpe?g|gif|webp|svg)$/i;
const MAX_TEXT_BYTES = 200_000;
const MAX_TEXT_CHARS = 100_000;

export interface ConversationPage {
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
}

export class ChatService {
  constructor(
    private readonly repo: BattleplanRepository,
    private readonly cursor: CursorClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async listProjectMessages(projectId: string): Promise<ConversationPage> {
    const project = await this.requireProject(projectId);
    if (project.cursor_agent_id) {
      await this.importFinishedRuns(project.cursor_agent_id, { scope: 'project', projectId });
      await this.syncArtifacts(project.cursor_agent_id, { scope: 'project', projectId });
    }
    return {
      messages: await this.repo.listProjectMessages(projectId),
      artifacts: await this.repo.listArtifacts('project', projectId),
    };
  }

  async sendProjectMessage(projectId: string, text: string): Promise<ChatMessage> {
    return this.dispatchProject(projectId, text, 'chat');
  }

  async generateTasks(projectId: string): Promise<ChatMessage> {
    return this.dispatchProject(projectId, GENERATE_TASKS_INSTRUCTION, 'generate_tasks');
  }

  async generateTaskTasks(taskId: string): Promise<ChatMessage> {
    const task = await this.requireTask(taskId);
    const project = await this.requireProject(task.project_id);
    const agentId = task.cursor_agent_id || project.cursor_agent_id;
    if (!agentId) throw new HttpError(409, 'This project is not linked to a Cursor agent.');
    const text = [
      `Generate tasks from the conversation for "${task.title}".`,
      task.prompt ? `Task prompt:\n${task.prompt}` : '',
      GENERATE_TASKS_INSTRUCTION,
    ].filter(Boolean).join('\n\n');
    const run = await this.cursor.createRun(agentId, {
      text,
      mode: task.cursor_agent_id ? 'agent' : 'plan',
    });
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: text,
      run_id: run.id,
      intent: 'generate_tasks',
      cursor_agent_id: agentId,
    });
  }

  async note(target: { scope: 'project'; projectId: string } | { scope: 'task'; taskId: string }, content: string): Promise<ChatMessage> {
    const text = content.trim();
    if (!text) throw new HttpError(400, 'message is required.');
    if (target.scope === 'project') {
      const project = await this.requireProject(target.projectId);
      return this.record({
        scope: 'project',
        project_id: project.project_id,
        role: 'change',
        content: text,
        intent: 'chat',
      });
    }
    const task = await this.requireTask(target.taskId);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'change',
      content: text,
      intent: 'chat',
    });
  }

  async listTaskMessages(taskId: string): Promise<{ messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }> {
    const task = await this.requireTask(taskId);
    if (task.cursor_agent_id) {
      await this.importFinishedRuns(task.cursor_agent_id, {
        scope: 'task',
        projectId: task.project_id,
        taskId,
      });
      await this.syncArtifacts(task.cursor_agent_id, {
        scope: 'task',
        projectId: task.project_id,
        taskId,
      });
    }
    await this.importReferencedRuns({
      scope: 'task',
      projectId: task.project_id,
      taskId,
    });
    const updated = await this.repo.getTask(taskId);
    return {
      messages: await this.repo.listTaskMessages(taskId),
      task: updated ?? task,
      artifacts: await this.repo.listArtifacts('task', taskId),
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
    const project = await this.requireProject(task.project_id);
    const run = await this.cursor.createRun(task.cursor_agent_id, {
      text: mergeApprovalPrompt(task, output.pr_link, project.starting_ref?.trim() || 'main'),
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
      const run = summary.result || TERMINAL_RUN.has(summary.status)
        ? summary
        : await this.cursor.getRun(agentId, summary.id);
      if (!TERMINAL_RUN.has(run.status)) continue;
      if (!existing.some((message) => message.run_id === run.id && message.role === 'assistant')) {
        const user = existing.find((message) => message.run_id === run.id && message.role === 'user');
        const saved = await this.record({
          scope: target.scope,
          project_id: target.projectId,
          task_id: target.scope === 'task' ? target.taskId : undefined,
          role: 'assistant',
          content: assistantText(run),
          run_id: run.id,
          intent: user?.intent ?? 'chat',
        });
        existing.push(saved);
      }
      if (target.scope === 'task') await this.applyTaskRun(target.taskId, run);
    }
  }

  private async importReferencedRuns(
    target: { scope: 'project'; projectId: string } | { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    const existing = target.scope === 'project'
      ? await this.repo.listProjectMessages(target.projectId)
      : await this.repo.listTaskMessages(target.taskId);
    const pending = existing.filter((message) => message.role === 'user'
      && message.run_id
      && message.cursor_agent_id
      && !existing.some((item) => item.role === 'assistant' && item.run_id === message.run_id));
    for (const message of pending) {
      const agentId = message.cursor_agent_id;
      const runId = message.run_id;
      if (!agentId || !runId) continue;
      let run;
      try {
        run = await this.cursor.getRun(agentId, runId);
      } catch {
        continue;
      }
      if (!TERMINAL_RUN.has(run.status)) continue;
      if (existing.some((item) => item.role === 'assistant' && item.run_id === run.id)) continue;
      const saved = await this.record({
        scope: target.scope,
        project_id: target.projectId,
        task_id: target.scope === 'task' ? target.taskId : undefined,
        role: 'assistant',
        content: assistantText(run),
        run_id: run.id,
        intent: message.intent ?? 'chat',
        cursor_agent_id: agentId,
      });
      existing.push(saved);
      if (target.scope === 'task') await this.applyTaskRun(target.taskId, run);
    }
  }

  private async syncArtifacts(
    agentId: string,
    target: { scope: 'project'; projectId: string } | { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    let remote: CursorArtifact[];
    try {
      remote = await this.cursor.listArtifacts(agentId);
    } catch {
      return;
    }
    const ownerId = target.scope === 'project' ? target.projectId : target.taskId;
    const stored = await this.repo.listArtifacts(target.scope, ownerId);
    for (const item of remote) {
      const kind = artifactKind(item.path, item.sizeBytes);
      const previous = stored.find((artifact) => artifact.path === item.path);
      if (previous && previous.updated_at === item.updatedAt && previous.size_bytes === item.sizeBytes) {
        if (kind === 'text' && previous.text) continue;
        if (kind !== 'text' && urlFresh(previous.url_expires_at, this.clock.nowIso())) continue;
      }
      const artifact: ChatArtifact = {
        scope: target.scope,
        project_id: target.projectId,
        task_id: target.scope === 'task' ? target.taskId : undefined,
        path: item.path,
        name: item.path.split('/').filter(Boolean).at(-1) || item.path,
        size_bytes: item.sizeBytes,
        updated_at: item.updatedAt,
        content_type: kind,
      };
      try {
        const download = await this.cursor.downloadArtifact(agentId, item.path);
        if (kind === 'text') artifact.text = await readArtifactText(download);
        else {
          artifact.url = download.url;
          artifact.url_expires_at = download.expiresAt;
        }
      } catch {
        if (previous?.text) artifact.text = previous.text;
        if (previous?.url) {
          artifact.url = previous.url;
          artifact.url_expires_at = previous.url_expires_at;
        }
      }
      await this.repo.saveArtifact(artifact);
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

function assistantText(run: CursorRun): string {
  const result = run.result?.trim();
  if (result) return result;
  if (run.status === 'FINISHED') return 'The agent finished. Attached files are shown with this conversation.';
  return `The agent run ended (${run.status}).`;
}

function artifactKind(path: string, sizeBytes: number): ArtifactKind {
  if (IMAGE_ARTIFACT.test(path)) return 'image';
  if (TEXT_ARTIFACT.test(path) && sizeBytes <= MAX_TEXT_BYTES) return 'text';
  return 'file';
}

function urlFresh(expiresAt: string | undefined, nowIso: string): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  const now = Date.parse(nowIso);
  return Number.isFinite(expires) && Number.isFinite(now) && expires > now + 60_000;
}

async function readArtifactText(download: ArtifactDownload): Promise<string> {
  const response = await fetch(download.url);
  if (!response.ok) throw new Error(`Artifact download failed (${response.status}).`);
  const text = await response.text();
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n…truncated…`;
}
