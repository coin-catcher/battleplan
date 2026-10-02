export const TASK_STATUSES = ['TODO', 'DOING', 'REVIEW', 'BLOCKED', 'DONE', 'ABANDONED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type OutputType = 'code' | 'research';

export interface Project {
  project_id: string;
  title: string;
  initial_prompt: string;
  cursor_chat_link: string;
  cursor_agent_id?: string;
  latest_run_id?: string;
  repo_url?: string;
  starting_ref?: string;
  map_x?: number;
  map_y?: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectTask {
  task_id: string;
  project_id: string;
  title: string;
  prompt: string;
  dependencies: string[];
  status: TaskStatus;
  output_type: OutputType;
  order: number;
  map_x?: number;
  map_y?: number;
  cursor_agent_id?: string;
  cursor_chat_link?: string;
  latest_run_id?: string;
  pending_action?: 'merge';
  created_at: string;
  updated_at: string;
}

export interface TaskCodeOutput {
  task_id: string;
  repo: string;
  branch: string;
  pr_message: string;
  pr_link: string;
}

export interface TaskResearchOutput extends TaskCodeOutput {
  path: string;
}

export interface ChatMessage {
  message_id: string;
  scope: 'project' | 'task';
  project_id: string;
  task_id?: string;
  role: 'user' | 'assistant' | 'change';
  content: string;
  created_at: string;
  run_id?: string;
  intent?: 'chat' | 'generate_tasks' | 'feedback' | 'approve';
  cursor_agent_id?: string;
}

export interface ChatArtifact {
  scope: 'project' | 'task';
  project_id: string;
  task_id?: string;
  path: string;
  name: string;
  size_bytes: number;
  updated_at: string;
  content_type: 'text' | 'image' | 'file';
  text?: string;
  url?: string;
  url_expires_at?: string;
}

export interface ConversationPage {
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
}

export interface TaskDraft {
  title: string;
  prompt: string;
  output_type: string;
  depends_on: string[];
}

export type Selection =
  | { kind: 'empty' }
  | { kind: 'create' }
  | { kind: 'project' }
  | { kind: 'task'; taskId: string }
  | { kind: 'code'; taskId: string }
  | { kind: 'research'; taskId: string };
