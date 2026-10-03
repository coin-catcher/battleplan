import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../src/app/core/models';

export interface AppConfigDocument {
  current_project_id: string | null;
  cursor_api_key: string;
  theme: string;
  pane_width: number;
  auto_save?: boolean;
}

export interface ProjectDocument {
  project: Project;
  messages: ChatMessage[];
  artifacts: StoredArtifact[];
}

export interface TaskDocument {
  task: ProjectTask;
  messages: ChatMessage[];
  code_output: TaskCodeOutput | null;
  research_output: TaskResearchOutput | null;
  artifacts: StoredArtifact[];
}

/** Artifact row persisted on disk; binary payloads live in sibling files. */
export type StoredArtifact = ChatArtifact & { local_file?: string };

export const DEFAULT_APP_CONFIG: AppConfigDocument = {
  current_project_id: null,
  cursor_api_key: '',
  theme: 'harbor',
  pane_width: 420,
};
