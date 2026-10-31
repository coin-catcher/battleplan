import type { GenerateTasksSessionState } from './generate-tasks-layered';
import { newDiscoveryGraphId } from './graph-discovery';

/** Pure session transition after a depth-first partition graph JSON import succeeds. */
export function discoverySessionAfterPartitionGraphImport(
  session: GenerateTasksSessionState,
): GenerateTasksSessionState {
  const nextPartitionIndex = session.partitionIndex + 1;
  if (session.partitionTitles.length > 0 && nextPartitionIndex < session.partitionTitles.length) {
    const focus = session.partitionTitles[nextPartitionIndex];
    return {
      ...session,
      partitionIndex: nextPartitionIndex,
      focusPartitionTitle: focus,
      layer: 1,
      activeGraphId: newDiscoveryGraphId(),
      activeGraphGoal: focus,
      awaitingGraphJson: false,
    };
  }
  return {
    ...session,
    phase: 'cluster_review',
    closingStep: 'cluster_review',
    architecturePromptSent: false,
    awaitingGraphJson: false,
  };
}
