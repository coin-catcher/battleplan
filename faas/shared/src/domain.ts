export const TASK_STATUSES = ['TODO', 'DOING', 'REVIEW', 'DONE', 'ABANDONED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OUTPUT_TYPES = ['code', 'research'] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

export type PendingAction = 'merge';
export type MessageRole = 'user' | 'assistant';
export type MessageIntent = 'chat' | 'generate_tasks' | 'feedback' | 'approve';

export interface Project {
  project_id: string;
  title: string;
  initial_prompt: string;
  cursor_chat_link: string;
  cursor_agent_id?: string;
  latest_run_id?: string;
  repo_url?: string;
  starting_ref?: string;
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
  cursor_agent_id?: string;
  cursor_chat_link?: string;
  latest_run_id?: string;
  pending_action?: PendingAction;
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
  role: MessageRole;
  content: string;
  created_at: string;
  run_id?: string;
  intent?: MessageIntent;
}

export interface NormalizedTaskDraft {
  title: string;
  prompt: string;
  output_type: OutputType;
  depends_on: string[];
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isOutputType(value: unknown): value is OutputType {
  return value === 'code' || value === 'research';
}

export function researchPath(projectId: string, taskId: string): string {
  return `research/${projectId}/${taskId}/`;
}
