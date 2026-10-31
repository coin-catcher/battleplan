import { findLastAssistantTaskGraph } from './generate-task-links';
import type { GenerateTasksSessionState } from './generate-tasks-layered';
import { isGraphCompleteCommand, tryParseGeneratedTasksFromSources } from './generate-tasks-layered';
import { newDiscoveryGraphId } from './graph-discovery';
import type { ChatArtifact, ChatMessage, Project, ProjectTask } from './models';
import { canRunGenerateTasks } from './task-generate-eligibility';
import { pickPrimaryParentId } from './dependencies';
import { messageContainsImportableTaskGraph, type ParsedGeneratedTasks } from './parse-tasks';

/** Stuck mid–Start Discovery before project.discovery_session was persisted. */
export function inferLegacyDiscoverySession(
  task: ProjectTask,
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
  project: Project | null,
  allTasks: ProjectTask[],
): GenerateTasksSessionState | null {
  if (!canRunGenerateTasks(task)) return null;
  if (project?.discovery_session?.source_task_id === task.task_id) return null;

  const graphMessage = findLastAssistantTaskGraph(messages, artifacts)
    ?? findLastAssistantImportableGraph(messages, artifacts);
  let parsed: ParsedGeneratedTasks | null = null;
  if (graphMessage) {
    parsed = tryParseGeneratedTasksFromSources(graphMessage.content, artifacts);
  }

  const started = messages.some((message) => message.role === 'user' && (
    message.intent === 'generate_tasks'
    || /start discovery/i.test(message.content)
  ));
  const chatUnderway = task.status === 'DOING' || task.status === 'REVIEW';
  const hasImportableGraph = Boolean(graphMessage && parsed?.tasks.length);
  if (!started && !chatUnderway && !hasImportableGraph) return null;

  const phase = inferLegacyPhase(task, allTasks, parsed);
  if (!phase) return null;

  return {
    sourceTaskId: task.task_id,
    phase,
    layer: 1,
    activeGraphId: newDiscoveryGraphId(),
    activeGraphGoal: task.title,
    partitionTitles: [],
    partitionIndex: 0,
    awaitingGraphJson: phase === 'depth_first'
      ? discoveryAwaitingPartitionGraphJson(messages, parsed)
      : undefined,
  };
}

/** User sent GRAPH DONE and the latest assistant message contains importable partition graph JSON. */
function discoveryAwaitingPartitionGraphJson(
  messages: ChatMessage[],
  parsed: ParsedGeneratedTasks | null,
): boolean {
  if (!parsed?.tasks.length) return false;
  const sentGraphDone = messages.some((message) => message.role === 'user' && isGraphCompleteCommand(message.content));
  return sentGraphDone;
}

function inferLegacyPhase(
  task: ProjectTask,
  allTasks: ProjectTask[],
  parsed: ParsedGeneratedTasks | null,
): GenerateTasksSessionState['phase'] | null {
  if (!parsed?.tasks.length) {
    return 'partition';
  }
  if (partitionLayerAlreadyImported(task, allTasks, parsed)) {
    return 'depth_first';
  }
  return 'partition';
}

export function partitionLayerAlreadyImported(
  source: ProjectTask,
  allTasks: ProjectTask[],
  parsed: ParsedGeneratedTasks,
): boolean {
  const titles = new Set(parsed.tasks.map((draft) => draft.title.trim()).filter(Boolean));
  if (titles.size === 0) return false;
  const children = allTasks.filter((candidate) => pickPrimaryParentId(candidate.task_id, allTasks) === source.task_id);
  let matched = 0;
  for (const title of titles) {
    if (children.some((child) => child.title.trim() === title)) matched += 1;
  }
  return matched >= titles.size;
}

function findLastAssistantImportableGraph(
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (messageContainsImportableTaskGraph(message.content, artifacts)) return message;
  }
  return null;
}

export function canOfferLegacyDiscoveryResume(
  task: ProjectTask,
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
  project: Project | null,
  allTasks: ProjectTask[],
): boolean {
  return inferLegacyDiscoverySession(task, messages, artifacts, project, allTasks) !== null;
}
