import type {
  ChatArtifact,
  ChatMessage,
  PendingChange,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../core/models';

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
}
