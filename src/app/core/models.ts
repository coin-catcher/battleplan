export const TASK_STATUSES = ['TODO', 'DOING', 'REVIEW', 'BLOCKED', 'DONE', 'ABANDONED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type OutputType = 'code' | 'research' | 'subproject';

export interface PendingChange {
  change_id: string;
  task_id: string;
  task_title: string;
  summary: string;
  pr_link?: string;
  merged_to_develop_at?: string;
  merged_to_main_at?: string;
}

export interface Project {
  project_id: string;
  title: string;
  initial_prompt: string;
  /** Persistent Data and Rules for this project, separate from chat history. */
  dar?: string;
  cursor_chat_link: string;
  cursor_agent_id?: string;
  latest_run_id?: string;
  repo_url?: string;
  starting_ref?: string;
  /** GitHub PAT for programmatic PR create/merge (stored locally in project_config.json). */
  github_pat?: string;
  map_x?: number;
  map_y?: number;
  /** Mindmap status for the root project node (nested subprojects use their task node). */
  status?: TaskStatus;
  /** When set, this project is nested under another project or task. */
  parent_project_id?: string;
  parent_task_id?: string;
  /** Child projects attached directly to this project. */
  subproject_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectTask {
  task_id: string;
  project_id: string;
  title: string;
  /** Legacy mirror of `dar`; kept for older saved projects. */
  prompt: string;
  /** Persistent Data and Rules for this task, separate from chat. */
  dar?: string;
  /** Saved instruction used once when starting the Cursor agent. */
  initial_prompt?: string;
  dependencies: string[];
  /** One-way sibling links: this task depends on the listed task ids (dashed mindmap arrows). */
  sibling_dependencies?: string[];
  status: TaskStatus;
  output_type: OutputType;
  /** Nested project opened by a subproject task. */
  subproject_id?: string;
  /** Child projects attached to this task. */
  subproject_ids?: string[];
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
  | { kind: 'subproject'; taskId: string }
  | { kind: 'code'; taskId: string }
  | { kind: 'research'; taskId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'agent-create'; role: AgentKind; draftId: string };

export const AGENT_KINDS = ['research', 'code'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_TYPES = ['OpenAI', 'Anthropic', 'Gemini', 'Grok', 'Cursor Agent', 'LocalLLM'] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type AgentOptionValue = string | number | boolean;

export interface ProjectAgent {
  agent_id: string;
  kind: AgentKind;
  type: AgentType;
  name: string;
  url: string;
  api_key?: string;
  /** Optional org Admin API key for provider usage/cost statistics (separate from chat api_key). */
  admin_api_key?: string;
  options?: Record<string, AgentOptionValue>;
  icon_asset?: string;
  cursor_agent_id?: string;
  last_test_at?: string;
  last_test_status?: 'success' | 'error';
  last_test_message?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentUsageLedger {
  calendar_month?: string;
  tokens_today?: number;
  tokens_period?: number;
  requests_today?: number;
  requests_period?: number;
  last_request_at?: string;
}
