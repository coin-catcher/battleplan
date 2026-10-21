import { Injectable, inject } from '@angular/core';
import type {
  AgentOptionValue,
  AgentType,
  ChatMessage,
  ConversationPage,
  OutputType,
  PendingChange,
  Project,
  ProjectAgent,
  ProjectTask,
  TaskCodeOutput,
  TaskDraft,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';
import { BrowserCursor } from '../data/cursor-browser';
import { CursorKey } from '../data/cursor-key.service';
import type { ProjectWorkspaceUiState } from '../core/project-ui-state';
import { createBattleplanRepository } from '../data/repository-factory';
import { LocalEngine } from '../data/local-engine';

@Injectable({ providedIn: 'root' })
export class BattleplanApi {
  private readonly keys = inject(CursorKey);
  private readonly repository = createBattleplanRepository();
  private readonly engine = new LocalEngine(
    this.repository,
    new BrowserCursor(() => this.keys.value()),
    undefined,
    undefined,
    () => this.keys.value(),
  );

  listProjects(): Promise<Project[]> {
    return this.engine.listProjects();
  }

  createProject(input: { initial_prompt: string; repo_url?: string; starting_ref?: string }): Promise<Project> {
    return this.engine.createProject(input);
  }

  updateTitle(projectId: string, title: string): Promise<Project> {
    return this.engine.updateProject(projectId, { title });
  }

  updateProject(projectId: string, patch: {
    title?: string;
    repo_url?: string;
    starting_ref?: string;
    dar?: string;
    initial_prompt?: string;
    github_pat?: string;
    map_x?: number;
    map_y?: number;
    default_research_agent_id?: string;
    default_code_agent_id?: string;
    status?: TaskStatus;
    manual?: boolean;
  }): Promise<Project> {
    return this.engine.updateProject(projectId, patch);
  }

  transitionProject(projectId: string, status: TaskStatus, manual: boolean): Promise<Project> {
    return this.engine.transitionProject(projectId, status, manual);
  }

  ensureAgentLibrary(projectId: string): Promise<Project> {
    return this.engine.ensureAgentLibrary(projectId);
  }

  deleteProject(projectId: string): Promise<void> {
    return this.engine.deleteProject(projectId);
  }

  listTasks(projectId: string): Promise<ProjectTask[]> {
    return this.engine.listTasks(projectId);
  }

  createTasks(projectId: string, tasks: TaskDraft[], parentTaskId?: string): Promise<ProjectTask[]> {
    return this.engine.createTasks(projectId, tasks, parentTaskId);
  }

  createTask(projectId: string, input: {
    depends_on?: string;
    title?: string;
    dar?: string;
    initial_prompt?: string;
    output_type?: OutputType;
    map_x?: number;
    map_y?: number;
  }): Promise<ProjectTask> {
    return this.engine.createTask(projectId, input);
  }

  updateTask(projectId: string, taskId: string, patch: Record<string, unknown>): Promise<ProjectTask> {
    return this.engine.updateTask(projectId, taskId, {
      title: typeof patch['title'] === 'string' ? patch['title'] : undefined,
      dar: typeof patch['dar'] === 'string' ? patch['dar'] : undefined,
      initial_prompt: typeof patch['initial_prompt'] === 'string' ? patch['initial_prompt'] : undefined,
      dependencies: Array.isArray(patch['dependencies']) ? patch['dependencies'] as string[] : undefined,
      sibling_dependencies: Array.isArray(patch['sibling_dependencies']) ? patch['sibling_dependencies'] as string[] : undefined,
      output_type: patch['output_type'] === 'code' || patch['output_type'] === 'research' || patch['output_type'] === 'subproject'
        ? patch['output_type']
        : undefined,
      status: typeof patch['status'] === 'string' ? patch['status'] as TaskStatus : undefined,
      manual: typeof patch['manual'] === 'boolean' ? patch['manual'] : undefined,
      map_x: typeof patch['map_x'] === 'number' ? patch['map_x'] : undefined,
      map_y: typeof patch['map_y'] === 'number' ? patch['map_y'] : undefined,
      research_agent_id: typeof patch['research_agent_id'] === 'string' ? patch['research_agent_id'] : undefined,
      code_agent_id: typeof patch['code_agent_id'] === 'string' ? patch['code_agent_id'] : undefined,
      brief: patch['brief'] as import('../core/task-brief').TaskBrief | undefined,
      regenerate_brief: patch['regenerate_brief'] === true ? true : undefined,
    });
  }

  deleteTask(projectId: string, taskId: string): Promise<void> {
    return this.engine.deleteTask(projectId, taskId);
  }

  reorderTasks(projectId: string, taskIds: string[]): Promise<ProjectTask[]> {
    return this.engine.reorderTasks(projectId, taskIds);
  }

  transition(projectId: string, taskId: string, status: TaskStatus, manual: boolean): Promise<ProjectTask> {
    return this.engine.transition(projectId, taskId, status, manual);
  }

  getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    return this.engine.getCodeOutput(taskId);
  }

  saveCodeOutput(taskId: string, output: Omit<TaskCodeOutput, 'task_id'>): Promise<TaskCodeOutput> {
    return this.engine.saveCodeOutput(taskId, output);
  }

  getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    return this.engine.getResearchOutput(taskId);
  }

  saveResearchOutput(taskId: string, output: Omit<TaskResearchOutput, 'task_id'>): Promise<TaskResearchOutput> {
    return this.engine.saveResearchOutput(taskId, output);
  }

  listProjectMessages(projectId: string): Promise<ConversationPage> {
    return this.engine.listProjectMessages(projectId);
  }

  listPendingChanges(projectId: string): Promise<PendingChange[]> {
    return this.engine.listPendingChanges(projectId);
  }

  listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
    return this.engine.listProjectAgents(projectId);
  }

  saveProjectAgents(projectId: string, agents: ProjectAgent[]): Promise<void> {
    return this.engine.saveProjectAgents(projectId, agents);
  }

  savePendingChanges(projectId: string, changes: PendingChange[]): Promise<void> {
    return this.engine.savePendingChanges(projectId, changes);
  }

  syncPendingChanges(projectId: string, input: {
    tasks: ProjectTask[];
    codeOutputs: Record<string, TaskCodeOutput | null>;
    researchOutputs: Record<string, TaskResearchOutput | null>;
    current: PendingChange[];
  }): Promise<PendingChange[]> {
    return this.engine.syncPendingChanges(projectId, input);
  }

  sendProjectMessage(projectId: string, message: string): Promise<ChatMessage> {
    return this.engine.sendProjectMessage(projectId, message);
  }

  generateTasks(projectId: string): Promise<ChatMessage> {
    return this.engine.generateTasks(projectId);
  }

  generateTaskTasks(taskId: string): Promise<ChatMessage> {
    return this.engine.generateTaskTasks(taskId);
  }

  noteProject(projectId: string, message: string): Promise<ChatMessage> {
    return this.engine.noteProject(projectId, message);
  }

  noteTask(taskId: string, message: string): Promise<ChatMessage> {
    return this.engine.noteTask(taskId, message);
  }

  listTaskMessages(taskId: string): Promise<{ messages: ChatMessage[]; task: ProjectTask; artifacts: ConversationPage['artifacts'] }> {
    return this.engine.listTaskMessages(taskId);
  }

  sendTaskMessage(taskId: string, message: string): Promise<ChatMessage> {
    return this.engine.sendTaskMessage(taskId, message);
  }

  executeTask(taskId: string): Promise<ChatMessage> {
    return this.engine.executeTask(taskId);
  }

  executeChildren(projectId: string, parentTaskId: string): Promise<ProjectTask[]> {
    return this.engine.executeChildren(projectId, parentTaskId);
  }

  relocateMindmapLink(
    projectId: string,
    link: { kind: 'child' | 'sibling' | 'project-root'; from: string; to: string },
    end: 'from' | 'to',
    dropNodeId: string,
  ): Promise<ProjectTask[]> {
    return this.engine.relocateMindmapLink(projectId, link, end, dropNodeId);
  }

  executeProjectChat(projectId: string): Promise<{ message: ChatMessage; project: Project }> {
    return this.engine.executeProjectChat(projectId);
  }

  convertTask(projectId: string, taskId: string, to: 'code' | 'subproject'): Promise<ProjectTask> {
    return this.engine.convertTask(projectId, taskId, to);
  }

  approve(taskId: string): Promise<ProjectTask> {
    return this.engine.approve(taskId);
  }

  releaseProjectChanges(projectId: string): Promise<ChatMessage> {
    return this.engine.releaseProjectChanges(projectId);
  }

  approveProjectRelease(projectId: string): Promise<Project> {
    return this.engine.approveProjectRelease(projectId);
  }

  getAgentUsageLedger(projectId: string): Promise<Record<string, import('../core/models').AgentUsageLedger>> {
    return this.repository.getAgentUsageLedger(projectId);
  }

  getProjectUiState(projectId: string): Promise<ProjectWorkspaceUiState | null> {
    return this.repository.getProjectUiState(projectId);
  }

  saveProjectUiState(projectId: string, state: ProjectWorkspaceUiState): Promise<void> {
    return this.repository.saveProjectUiState(projectId, state);
  }
}

export type AgentEditorSaveInput = {
  type: AgentType;
  name: string;
  url: string;
  api_key?: string;
  apiKeyEdited: boolean;
  admin_api_key?: string;
  adminApiKeyEdited: boolean;
  options: Record<string, AgentOptionValue>;
};
