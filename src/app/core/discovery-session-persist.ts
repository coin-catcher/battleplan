import type { DiscoverySessionState } from './graph-discovery';
import type { GenerateTasksSessionState } from './generate-tasks-layered';
import type { ChatMessage } from './models';

export function discoveryMessageKey(message: ChatMessage): string {
  if (message.run_id) return `run:${message.run_id}`;
  if (message.message_id) return `msg:${message.message_id}`;
  return `content:${message.content.length}:${message.content.slice(0, 64)}`;
}

export function generateTasksSessionFromPersisted(
  persisted: DiscoverySessionState,
): GenerateTasksSessionState {
  return {
    sourceTaskId: persisted.source_task_id,
    phase: persisted.phase ?? 'partition',
    layer: persisted.layer ?? 1,
    activeGraphId: persisted.active_graph_id,
    activeGraphGoal: persisted.active_graph_goal,
    partitionTitles: persisted.partition_titles ?? [],
    partitionIndex: persisted.partition_index ?? 0,
    focusPartitionTitle: persisted.focus_partition_title,
    awaitingGraphJson: persisted.awaiting_graph_json,
    closingStep: persisted.closing_step,
    architecturePromptSent: persisted.architecture_prompt_sent,
    lastImportedMessageKey: persisted.last_imported_message_key,
  };
}

export function persistedDiscoverySessionFromGenerateTasks(
  session: GenerateTasksSessionState,
): DiscoverySessionState {
  return {
    source_task_id: session.sourceTaskId,
    mode: 'depth_first',
    phase: session.phase,
    active_graph_id: session.activeGraphId,
    active_graph_goal: session.activeGraphGoal,
    layer: session.layer,
    partition_titles: session.partitionTitles,
    partition_index: session.partitionIndex,
    focus_partition_title: session.focusPartitionTitle,
    awaiting_graph_json: session.awaitingGraphJson,
    closing_step: session.closingStep,
    architecture_prompt_sent: session.architecturePromptSent,
    last_imported_message_key: session.lastImportedMessageKey,
    next_action: describeDiscoveryNextAction(session),
  };
}

export function describeDiscoveryNextAction(session: GenerateTasksSessionState): string {
  if (session.closingStep === 'architecture' || session.phase === 'architecture_pass') {
    return 'Import architecture fan-in JSON from the agent when ready.';
  }
  if (session.closingStep === 'cluster_review' || session.phase === 'cluster_review') {
    return 'Continue cluster review in chat; Battleplan will run the architecture pass next.';
  }
  if (session.phase === 'partition') {
    return 'Approve Layer 1 partition titles in chat; Battleplan imports JSON when the agent sends it.';
  }
  if (session.awaitingGraphJson) {
    return 'Waiting for JSON for the current partition graph after GRAPH DONE.';
  }
  if (session.phase === 'depth_first') {
    const focus = session.focusPartitionTitle ?? session.activeGraphGoal;
    return `Depth-first discovery for "${focus}" — chat with the agent, then send GRAPH DONE for JSON import.`;
  }
  return 'Continue Start Discovery in chat.';
}
