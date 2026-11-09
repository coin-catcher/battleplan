import type {
  ChatArtifact,
  ChatMessage,
  ConversationPage,
  Project,
  ProjectTask,
  Selection,
} from '../core/models';

/** Store-facing hooks so agent polling can persist chat/task rows without owning UI state. */
export interface AgentCommunicationsBridge {
  tasks(): ProjectTask[];
  projectId(): string | null;
  selection(): Selection;
  subprojectCursorAgentId(subprojectId: string): string | undefined;
  rootProject(): Project | null;
  isWatchingTaskChat(taskId: string): boolean;
  isWatchingProjectChat(projectId: string): boolean;
  onTaskConversation(result: { messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }): void;
  onProjectConversation(page: ConversationPage): void;
  onSubprojectTaskBundle(taskId: string, page: ConversationPage, task: ProjectTask): void;
  reloadProjects(): Promise<void>;
  refreshOutput(task: ProjectTask): Promise<void>;
}
