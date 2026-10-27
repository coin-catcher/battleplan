import type { GraphDiscoveryIndexEntry } from './graph-discovery';
import type { Project, ProjectTask } from './models';

export interface DiscoveryPartitionSummary {
  partitionTitle: string;
  graphId: string;
  taskCount: number;
  patterns: string[];
}

export interface DiscoveryCompleteSummary {
  sourceTaskTitle: string;
  partitions: DiscoveryPartitionSummary[];
}

export function buildDiscoveryCompleteSummary(
  project: Project | null,
  tasks: ProjectTask[],
  sourceTaskId: string,
): DiscoveryCompleteSummary {
  const source = tasks.find((task) => task.task_id === sourceTaskId);
  const index = project?.graph_discovery_index ?? [];
  const partitions = index.map((entry) => summaryFromIndexEntry(entry, tasks));
  return {
    sourceTaskTitle: source?.title ?? 'Discovery root',
    partitions,
  };
}

function summaryFromIndexEntry(
  entry: GraphDiscoveryIndexEntry,
  tasks: ProjectTask[],
): DiscoveryPartitionSummary {
  const graphTasks = tasks.filter((task) => task.graph_id === entry.graph_id);
  const patterns = entry.patterns_used?.length
    ? entry.patterns_used
    : [...new Set(graphTasks.map((task) => task.pattern_id).filter(Boolean) as string[])];
  return {
    partitionTitle: entry.partition_title ?? entry.final_goal,
    graphId: entry.graph_id,
    taskCount: entry.task_count ?? graphTasks.length,
    patterns,
  };
}
