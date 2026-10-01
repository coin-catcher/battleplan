import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from './domain.js';

export interface WarplanRepository {
  saveProject(project: Project): Promise<void>;
  getProject(projectId: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  findProjectByAgent(agentId: string): Promise<Project | null>;
  deleteProject(projectId: string): Promise<void>;

  saveTask(task: ProjectTask): Promise<void>;
  saveTasks(tasks: ProjectTask[]): Promise<void>;
  getTask(taskId: string): Promise<ProjectTask | null>;
  listTasks(projectId: string): Promise<ProjectTask[]>;
  findTaskByAgent(agentId: string): Promise<ProjectTask | null>;
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
}
