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
} from '../src/app/core/models';

export interface AppWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectUiState {
  pane_width: number;
  mindmap_zoom: number;
  mindmap_origin_x: number;
  mindmap_origin_y: number;
}

export interface AppConfigDocument {
  current_project_id: string | null;
  cursor_api_key: string;
  /** GitHub PAT for checking and downloading Battleplan desktop releases. */
  github_pat?: string;
  theme: string;
  pane_width: number;
  auto_save?: boolean;
  open_project_ids?: string[];
  window_maximized?: boolean;
  window_bounds?: AppWindowBounds;
}

export interface ProjectDocument {
  project: Project;
  messages: ChatMessage[];
  artifacts: StoredArtifact[];
  pending_changes?: PendingChange[];
  agents?: ProjectAgent[];
  agent_usage_ledger?: Record<string, AgentUsageLedger>;
  ui?: ProjectUiState;
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
