import type { ProjectTask } from './models';

/** Brainstorm or Research discovery-root tasks (not generic code/research execution tasks). */
export function isDiscoveryRootTask(task: ProjectTask | undefined): boolean {
  return canRunGenerateTasks(task);
}

/** Start Discovery is only available on Brainstorm and Research discovery roots. */
export function canRunGenerateTasks(task: ProjectTask | undefined): boolean {
  if (!task) return false;
  if (task.output_type === 'subproject') return false;
  if (task.node_kind === 'brainstorm') return true;
  if (task.output_type === 'research' && task.node_kind !== 'critique' && task.node_kind !== 'architect') {
    return true;
  }
  return false;
}
