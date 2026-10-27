/** n8n deterministic workflow catalog entry (local n8n instance; hybrid flows deferred). */

export interface N8nWorkflowParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
}

export interface N8nWorkflowDefinition {
  workflow_id: string;
  name: string;
  description?: string;
  /** n8n workflow id or webhook path on local instance. */
  n8n_workflow_id: string;
  version: string;
  parameters: N8nWorkflowParameter[];
  output_paths?: string[];
  /** Source task graph ids when created via Dynamic → Deterministic Converter. */
  source_graph_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface TaskTemplateDefinition {
  template_id: string;
  name: string;
  description?: string;
  /** Partial defaults merged into tasks using this template. */
  defaults: {
    output_type?: string;
    node_kind?: string;
    lifecycle_phase?: string;
    brief_standing?: string;
    pattern_id?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface ExecuteTaskConfig {
  mode: 'script' | 'workflow';
  /** Shell script or command line when mode=script. */
  script?: string;
  /** Catalog workflow_id when mode=workflow. */
  workflow_id?: string;
  /** Parameter values keyed by parameter name. */
  workflow_parameters?: Record<string, string | number | boolean>;
}

export interface AddWorkflowTaskConfig {
  /** Populated after successful add_workflow run. */
  target_workflow_id?: string;
  source_graph_ids?: string[];
}

export interface TemplateInstanceRunState {
  template_graph_id: string;
  instances: string[];
  current_index: number;
  status: 'idle' | 'running' | 'paused' | 'done';
}
