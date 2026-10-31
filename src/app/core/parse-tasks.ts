import type { ChatArtifact, TaskDraft, TaskConnectorKind } from './models';
import { TASK_CONNECTOR_KINDS } from './models';
import { parseGeneratedEdgeList, type GeneratedTaskEdgeDraft } from './generate-task-graph';
import { taskBriefFromDraftRecord } from './task-brief';
import { normalizeLoopMode, normalizeTaskNodeKind } from './task-node-kind';
import { normalizeLifecyclePhase } from './task-lifecycle';
import { resolveDraftFieldsFromWorkflow } from './workflow-task-kind';

export interface ParsedGeneratedTasks {
  tasks: TaskDraft[];
  edges: GeneratedTaskEdgeDraft[];
}

export function parseGeneratedTasksFromSources(text: string, artifacts: ChatArtifact[]): ParsedGeneratedTasks {
  const errors: string[] = [];
  try {
    return parseGeneratedTasksPayload(text);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Could not parse agent text.');
  }
  for (const artifact of artifacts) {
    if (artifact.content_type !== 'text' || !artifact.text?.trim()) continue;
    const trimmed = artifact.text.trim();
    if (!/\.json$/i.test(artifact.name) && !trimmed.startsWith('[') && !trimmed.startsWith('{')) continue;
    try {
      return parseGeneratedTasksPayload(artifact.text);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Could not parse artifact text.');
    }
  }
  throw new Error(errors[0] ?? 'No JSON task array found in the agent response.');
}

/** @deprecated Use parseGeneratedTasksFromSources for graph edges. */
export function parseGeneratedTaskListFromSources(text: string, artifacts: ChatArtifact[]): TaskDraft[] {
  return parseGeneratedTasksFromSources(text, artifacts).tasks;
}

export function parseGeneratedTasksPayload(text: string): ParsedGeneratedTasks {
  const jsonText = extractGenerateTasksJson(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error('The agent response did not contain valid JSON.');
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error('The task list is empty.');
    return { tasks: parseGeneratedTaskRecords(parsed), edges: [] };
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Generate Tasks JSON must be an array or an object with a tasks array.');
  }
  const record = parsed as Record<string, unknown>;
  const tasksRaw = record['tasks'] ?? record['nodes'];
  if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
    throw new Error('The task list is empty.');
  }
  const idToTitle = buildAgentTaskIdToTitleMap(tasksRaw);
  const defaultGraphId = typeof record['graph_id'] === 'string' ? record['graph_id'].trim() : undefined;
  const edges = parseGeneratedEdgeList(
    record['edges'] ?? record['graph_edges'] ?? record['links'],
    idToTitle,
  );
  return { tasks: parseGeneratedTaskRecords(tasksRaw, idToTitle, defaultGraphId), edges };
}

export function parseGeneratedTaskList(text: string): TaskDraft[] {
  return parseGeneratedTasksPayload(text).tasks;
}

function extractGenerateTasksJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? text;
  const objectStart = source.indexOf('{');
  const arrayStart = source.indexOf('[');
  let start = -1;
  if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) {
    start = objectStart;
    const end = source.lastIndexOf('}');
    if (end <= start) throw new Error('No JSON task payload found in the agent response.');
    return source.slice(start, end + 1);
  }
  start = arrayStart;
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new Error('No JSON task array found in the agent response.');
  }
  return source.slice(start, end + 1);
}

function buildAgentTaskIdToTitleMap(tasksRaw: unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of tasksRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = optionalText(record['id']);
    const title = optionalText(record['title']);
    if (id && title) map.set(id, title);
  }
  return map;
}

function resolveTaskDependencyRefs(
  raw: unknown,
  idToTitle: Map<string, string>,
  titlesInBatch: Set<string>,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const token = entry.trim();
    if (!token) continue;
    if (idToTitle.has(token)) {
      out.push(idToTitle.get(token)!);
      continue;
    }
    if (titlesInBatch.has(token)) {
      out.push(token);
    }
  }
  return out;
}

function parseGeneratedTaskRecords(
  parsed: unknown[],
  idToTitle: Map<string, string> = new Map(),
  defaultGraphId?: string,
): TaskDraft[] {
  const titlesInBatch = new Set<string>();
  for (const item of parsed) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const title = optionalText((item as Record<string, unknown>)['title']);
      if (title) titlesInBatch.add(title);
    }
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Task ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const title = requiredText(record['title'], `Task ${index + 1} title`);
    const briefPath = optionalText(record['brief_path']);
    const prompt = optionalText(record['prompt'])
      ?? optionalText(record['initial_prompt'])
      ?? (briefPath ? `Follow the brief at ${briefPath}` : undefined)
      ?? title;
    const workflowFields = resolveDraftFieldsFromWorkflow(record);
    const outputRaw = workflowFields.output_type ?? record['output_type'] ?? record['task_kind'];
    const output = typeof outputRaw === 'string' && outputRaw.trim()
      ? outputRaw.trim()
      : 'research';
    const dependsRaw = record['depends_on'] ?? record['dependencies'] ?? [];
    const inputsRaw = record['inputs'] ?? [];
    if (!Array.isArray(dependsRaw) || dependsRaw.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Task ${index + 1} depends_on must be an array of task titles.`);
    }
    if (!Array.isArray(inputsRaw) || inputsRaw.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Task ${index + 1} inputs must be an array of strings when present.`);
    }
    const depends = resolveTaskDependencyRefs([...dependsRaw, ...inputsRaw], idToTitle, titlesInBatch);
    const sequentialRaw = record['sequential_with']
      ?? record['sibling_dependencies']
      ?? record['conflicts_with']
      ?? [];
    if (!Array.isArray(sequentialRaw) || sequentialRaw.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Task ${index + 1} sequential_with must be an array of task titles.`);
    }
    const brief = taskBriefFromDraftRecord(record);
    const nodeKind = workflowFields.node_kind
      ?? (record['node_kind'] !== undefined ? normalizeTaskNodeKind(record['node_kind']) : undefined);
    const loopMode = normalizeLoopMode(record['loop_mode']);
    const connector = parseConnectorKind(record['connector_kind']);
    const lifecyclePhase = workflowFields.lifecycle_phase
      ?? normalizeLifecyclePhase(record['lifecycle_phase']);
    const repoPath = typeof record['repo_path'] === 'string' && record['repo_path'].trim()
      ? record['repo_path'].trim()
      : repoPathFromBriefPath(briefPath);
    const patternIdRaw = record['pattern_id'];
    const patternId = typeof patternIdRaw === 'string' && patternIdRaw.trim()
      ? patternIdRaw.trim()
      : undefined;
    const graphIdRaw = record['graph_id'];
    const graphId = typeof graphIdRaw === 'string' && graphIdRaw.trim()
      ? graphIdRaw.trim()
      : defaultGraphId;
    const crossGraph = record['cross_graph_edit'] === true ? true : undefined;
    const crossRationale = typeof record['cross_graph_edit_rationale'] === 'string'
      ? record['cross_graph_edit_rationale'].trim()
      : undefined;
    const templateIds = Array.isArray(record['template_ids'])
      ? record['template_ids'].filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
      : undefined;
    const gitPathsRaw = record['git_paths'] ?? record['collateral_paths'];
    const gitPaths = Array.isArray(gitPathsRaw)
      ? gitPathsRaw.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
      : undefined;
    return {
      title,
      prompt,
      output_type: output.trim(),
      depends_on: depends.map((entry) => entry.trim()).filter(Boolean),
      sequential_with: sequentialRaw.map((entry) => entry.trim()).filter(Boolean),
      node_kind: nodeKind,
      loop_mode: loopMode,
      brief,
      connector_kind: connector,
      lifecycle_phase: lifecyclePhase,
      ...(repoPath ? { repo_path: repoPath } : {}),
      ...(briefPath ? { brief_path: briefPath } : {}),
      ...(gitPaths?.length ? { git_paths: gitPaths } : {}),
      ...(patternId ? { pattern_id: patternId } : {}),
      ...(graphId ? { graph_id: graphId } : {}),
      ...(templateIds?.length ? { template_ids: templateIds } : {}),
      ...(crossGraph ? { cross_graph_edit: true } : {}),
      ...(crossRationale ? { cross_graph_edit_rationale: crossRationale } : {}),
    };
  });
}

function parseConnectorKind(value: unknown): TaskConnectorKind | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toLowerCase();
  return (TASK_CONNECTOR_KINDS as readonly string[]).includes(token)
    ? (token as TaskConnectorKind)
    : undefined;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** battleplan/.../outputs/brief.md → battleplan/.../outputs/ */
function repoPathFromBriefPath(briefPath: string | undefined): string | undefined {
  if (!briefPath) return undefined;
  const normalized = briefPath.replace(/\\/g, '/');
  if (normalized.endsWith('/brief.md')) {
    return normalized.slice(0, -'brief.md'.length);
  }
  if (normalized.endsWith('brief.md')) {
    return normalized.slice(0, -'brief.md'.length);
  }
  return undefined;
}

export function messageContainsImportableTaskGraph(text: string, artifacts: ChatArtifact[] = []): boolean {
  try {
    parseGeneratedTasksFromSources(text, artifacts);
    return true;
  } catch {
    return false;
  }
}
