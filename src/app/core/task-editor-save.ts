import type { LifecyclePhase, OutputType, ProjectTask } from './models';
import type { TaskNodeKind } from './task-node-kind';
import type { TaskBrief } from './task-brief';
import type { ExecuteTaskConfig } from './n8n-workflow';
import {
  fieldsFromTaskEditorKind,
  type TaskEditorKind,
} from './task-editor-kind';

export interface TaskEditorSaveInput {
  title: string;
  initial_prompt: string;
  editor_kind: TaskEditorKind;
  dependencies: string[];
  sibling_dependencies: string[];
  research_agent_id: string;
  code_agent_id: string;
  repo_path: string;
  brief: TaskBrief;
  execute_config?: ExecuteTaskConfig;
}

/** Patch for updateTask; omits initial_prompt when a Cursor agent has already started. */
export function buildTaskEditorSavePatch(
  task: ProjectTask,
  input: TaskEditorSaveInput,
): {
  title: string;
  initial_prompt?: string;
  output_type: OutputType;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
  repo_path?: string;
  execute_config?: ExecuteTaskConfig;
  dependencies: string[];
  sibling_dependencies: string[];
  research_agent_id?: string;
  code_agent_id?: string;
  brief: TaskBrief;
} {
  const kindFields = fieldsFromTaskEditorKind(input.editor_kind);
  const patch: ReturnType<typeof buildTaskEditorSavePatch> = {
    title: input.title,
    output_type: kindFields.output_type,
    node_kind: kindFields.node_kind,
    lifecycle_phase: kindFields.lifecycle_phase,
    repo_path: input.repo_path.trim() || undefined,
    execute_config: input.execute_config,
    dependencies: input.dependencies,
    sibling_dependencies: input.sibling_dependencies,
    research_agent_id: input.research_agent_id || undefined,
    code_agent_id: input.code_agent_id || undefined,
    brief: input.brief,
  };
  if (!task.cursor_agent_id) {
    patch.initial_prompt = input.initial_prompt;
  }
  return patch;
}