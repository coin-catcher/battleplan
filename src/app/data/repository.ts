import type {
  AgentUsageLedger,
  ChatArtifact,
  ChatMessage,
  PendingChange,
  Project,
  ProjectAgent,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../core/models';
import type { ProjectWorkspaceUiState } from '../core/project-ui-state';

export interface BattleplanRepository {
  saveProject(project: Project): Promise<void>;
  getProject(projectId: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  deleteProject(projectId: string): Promise<void>;

  saveTask(task: ProjectTask): Promise<void>;
  saveTasks(tasks: ProjectTask[]): Promise<void>;
  getTask(taskId: string): Promise<ProjectTask | null>;
  listTasks(projectId: string): Promise<ProjectTask[]>;
  deleteTask(taskId: string): Promise<void>;

  getCodeOutput(taskId: string): Promise<TaskCodeOutput | null>;
  saveCodeOutput(output: TaskCodeOutput): Promise<void>;
  getResearchOutput(taskId: string): Promise<TaskResearchOutput | null>;
  saveResearchOutput(output: TaskResearchOutput): Promise<void>;

  listProjectMessages(projectId: string): Promise<ChatMessage[]>;
  listTaskMessages(taskId: string): Promise<ChatMessage[]>;
  saveMessage(message: ChatMessage): Promise<void>;

  listArtifacts(scope: 'project' | 'task', ownerId: string): Promise<ChatArtifact[]>;
  saveArtifact(artifact: ChatArtifact): Promise<void>;

  listPendingChanges(projectId: string): Promise<PendingChange[]>;
  savePendingChanges(projectId: string, changes: PendingChange[]): Promise<void>;

  listProjectAgents(projectId: string): Promise<ProjectAgent[]>;
  saveProjectAgents(projectId: string, agents: ProjectAgent[]): Promise<void>;
  getAgentUsageLedger(projectId: string): Promise<Record<string, AgentUsageLedger>>;
  saveAgentUsageLedger(projectId: string, ledger: Record<string, AgentUsageLedger>): Promise<void>;

  getProjectUiState(projectId: string): Promise<ProjectWorkspaceUiState | null>;
  saveProjectUiState(projectId: string, state: ProjectWorkspaceUiState): Promise<void>;

  /** Write a git-relative battleplan/ path under the project workspace (mirrors GitHub layout). */
  writeGitMirrorFile(projectId: string, gitRelativePath: string, content: string): Promise<void>;
  readGitMirrorFile(projectId: string, gitRelativePath: string): Promise<string | null>;
}
