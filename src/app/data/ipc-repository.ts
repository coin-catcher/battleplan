import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../core/models';
import type { BattleplanRepository } from './repository';
import { electronBridge } from './electron-bridge';

function bridge() {
  const client = electronBridge();
  if (!client) throw new Error('Electron bridge is not available.');
  return client;
}

export class IpcRepository implements BattleplanRepository {
  saveProject(project: Project): Promise<void> {
    return bridge().invoke('repo:saveProject', project);
  }

  getProject(projectId: string): Promise<Project | null> {
    return bridge().invoke('repo:getProject', projectId);
  }

  listProjects(): Promise<Project[]> {
    return bridge().invoke('repo:listProjects');
  }

  deleteProject(projectId: string): Promise<void> {
    return bridge().invoke('repo:deleteProject', projectId);
  }

  saveTask(task: ProjectTask): Promise<void> {
    return bridge().invoke('repo:saveTask', task);
  }

  saveTasks(tasks: ProjectTask[]): Promise<void> {
    return bridge().invoke('repo:saveTasks', tasks);
  }

  getTask(taskId: string): Promise<ProjectTask | null> {
    return bridge().invoke('repo:getTask', taskId);
  }

  listTasks(projectId: string): Promise<ProjectTask[]> {
    return bridge().invoke('repo:listTasks', projectId);
  }

  deleteTask(taskId: string): Promise<void> {
    return bridge().invoke('repo:deleteTask', taskId);
  }

  getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    return bridge().invoke('repo:getCodeOutput', taskId);
  }

  saveCodeOutput(output: TaskCodeOutput): Promise<void> {
    return bridge().invoke('repo:saveCodeOutput', output);
  }

  getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    return bridge().invoke('repo:getResearchOutput', taskId);
  }

  saveResearchOutput(output: TaskResearchOutput): Promise<void> {
    return bridge().invoke('repo:saveResearchOutput', output);
  }

  listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    return bridge().invoke('repo:listProjectMessages', projectId);
  }

  listTaskMessages(taskId: string): Promise<ChatMessage[]> {
    return bridge().invoke('repo:listTaskMessages', taskId);
  }

  saveMessage(message: ChatMessage): Promise<void> {
    return bridge().invoke('repo:saveMessage', message);
  }

  listArtifacts(scope: 'project' | 'task', ownerId: string): Promise<ChatArtifact[]> {
    return bridge().invoke('repo:listArtifacts', scope, ownerId);
  }

  saveArtifact(artifact: ChatArtifact): Promise<void> {
    return bridge().invoke('repo:saveArtifact', artifact);
  }

  listPendingChanges(projectId: string): Promise<import('../core/models').PendingChange[]> {
    return bridge().invoke('repo:listPendingChanges', projectId);
  }

  savePendingChanges(projectId: string, changes: import('../core/models').PendingChange[]): Promise<void> {
    return bridge().invoke('repo:savePendingChanges', projectId, changes);
  }

  listProjectAgents(projectId: string): Promise<import('../core/models').ProjectAgent[]> {
    return bridge().invoke('repo:listProjectAgents', projectId);
  }

  saveProjectAgents(projectId: string, agents: import('../core/models').ProjectAgent[]): Promise<void> {
    return bridge().invoke('repo:saveProjectAgents', projectId, agents);
  }

  getAgentUsageLedger(projectId: string): Promise<Record<string, import('../core/models').AgentUsageLedger>> {
    return bridge().invoke('repo:getAgentUsageLedger', projectId);
  }

  saveAgentUsageLedger(
    projectId: string,
    ledger: Record<string, import('../core/models').AgentUsageLedger>,
  ): Promise<void> {
    return bridge().invoke('repo:saveAgentUsageLedger', projectId, ledger);
  }

  getProjectUiState(projectId: string): Promise<import('../core/project-ui-state').ProjectWorkspaceUiState | null> {
    return bridge().invoke('repo:getProjectUiState', projectId);
  }

  saveProjectUiState(
    projectId: string,
    state: import('../core/project-ui-state').ProjectWorkspaceUiState,
  ): Promise<void> {
    return bridge().invoke('repo:saveProjectUiState', projectId, state);
  }
}
