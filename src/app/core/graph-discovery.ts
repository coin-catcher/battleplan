import type { Project, ProjectTask } from './models';

export interface GraphDiscoveryIndexEntry {
  graph_id: string;
  root_task_id: string;
  final_goal: string;
  task_summary: string;
  completed_at: string;
  partition_title?: string;
  task_count?: number;
  patterns_used?: string[];
}

export interface DiscoverySessionState {
  source_task_id: string;
  mode: 'depth_first';
  phase?: 'partition' | 'depth_first' | 'cluster_review' | 'architecture_pass';
  active_graph_id: string;
  active_graph_goal: string;
  layer: number;
  partition_titles?: string[];
  partition_index?: number;
  focus_partition_title?: string;
  awaiting_graph_json?: boolean;
  closing_step?: 'cluster_review' | 'architecture';
  architecture_prompt_sent?: boolean;
}

export function newDiscoveryGraphId(): string {
  return `graph-${crypto.randomUUID()}`;
}

export function formatGraphIndexForPrompt(index: GraphDiscoveryIndexEntry[] | undefined): string {
  if (!index?.length) return 'No completed task graphs in the index yet.';
  return index.map((entry, i) => (
    `${i + 1}. graph_id=${entry.graph_id}\n   Goal: ${entry.final_goal}\n   Summary: ${entry.task_summary}`
  )).join('\n\n');
}

/** Tasks in the active graph (same graph_id or created under source during session). */
export function tasksInActiveGraph(tasks: ProjectTask[], session: DiscoverySessionState): ProjectTask[] {
  return tasks.filter((task) => task.graph_id === session.active_graph_id);
}

export function appendGraphIndexEntry(
  index: GraphDiscoveryIndexEntry[] | undefined,
  entry: GraphDiscoveryIndexEntry,
): GraphDiscoveryIndexEntry[] {
  return [...(index ?? []), entry];
}

export function crossGraphEditNotice(
  project: Project | null,
  editingGraphId: string,
  targetTask: ProjectTask,
): string | undefined {
  if (!targetTask.graph_id || targetTask.graph_id === editingGraphId) return undefined;
  const prior = project?.graph_discovery_index?.find((e) => e.graph_id === targetTask.graph_id);
  return [
    '**Cross-graph task edit** (must be explicit in agent chat):',
    `- Target task "${targetTask.title}" belongs to graph \`${targetTask.graph_id}\`${prior ? ` (${prior.final_goal})` : ''}.`,
    `- Current discovery graph: \`${editingGraphId}\`.`,
    '- Explain why this change is needed and list affected tasks.',
  ].join('\n');
}
