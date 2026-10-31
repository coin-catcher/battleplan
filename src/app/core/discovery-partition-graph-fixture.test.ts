import { describe, expect, it } from 'vitest';
import type { ChatMessage, ProjectTask } from './models';
import {
  buildSupabasePartitionGraphAssistantMessage,
  LAYER1_PARTITION_TITLES,
  SUPABASE_GRAPH_DONE_USER_MESSAGE,
  SUPABASE_PARTITION_GRAPH_JSON,
} from './fixtures/supabase-partition-graph-messages';
import { isGraphCompleteCommand } from './generate-tasks-layered';
import {
  messageContainsImportableTaskGraph,
  parseGeneratedTasksPayload,
} from './parse-tasks';
import { prepareGeneratedDraftsForDiscovery } from './generate-task-links';
import {
  previewGraphForGeneratedTasks,
  validateAndRepairGeneratedTasks,
} from './validate-generated-tasks';
import { reconcileDiscoverySessionFromChat } from './discovery-session-recovery';
import { describeDiscoveryNextAction } from './discovery-session-persist';
import type { GenerateTasksSessionState } from './generate-tasks-layered';
import { partitionLayerAlreadyImported } from './discovery-legacy-resume';
import { discoverySessionAfterPartitionGraphImport } from './discovery-session-advance';

const BATTLEPLAN_PROJECT_ID = '15ddb36c-b9ec-4732-9ac1-6049da532e8a';
const PARTITION_TITLE = 'Supabase backend foundation';

function discoveryChatMessages(): ChatMessage[] {
  return [
    {
      message_id: 'u-graph-done',
      scope: 'task',
      project_id: BATTLEPLAN_PROJECT_ID,
      task_id: 'brainstorm-root',
      role: 'user',
      content: SUPABASE_GRAPH_DONE_USER_MESSAGE,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      message_id: 'a-graph-json',
      scope: 'task',
      project_id: BATTLEPLAN_PROJECT_ID,
      task_id: 'brainstorm-root',
      role: 'assistant',
      content: buildSupabasePartitionGraphAssistantMessage(),
      created_at: '2026-01-01T00:01:00Z',
    },
  ];
}

function mindmapWithLayer1Partitions(): ProjectTask[] {
  const root: ProjectTask = {
    task_id: 'brainstorm-root',
    project_id: BATTLEPLAN_PROJECT_ID,
    title: 'Brainstorm',
    prompt: '',
    dependencies: ['p1', 'p2', 'p3'],
    status: 'DOING',
    output_type: 'research',
    node_kind: 'brainstorm',
    order: 0,
    created_at: '',
    updated_at: '',
  };
  const partitions = LAYER1_PARTITION_TITLES.map((title, index) => ({
    task_id: `p${index + 1}`,
    project_id: BATTLEPLAN_PROJECT_ID,
    title,
    prompt: '',
    dependencies: [],
    status: 'TODO' as const,
    output_type: 'research' as const,
    order: index + 1,
    created_at: '',
    updated_at: '',
  }));
  return [root, ...partitions];
}

describe('Supabase partition graph chat fixture', () => {
  it('recognizes GRAPH DONE in the user approval block', () => {
    expect(isGraphCompleteCommand(SUPABASE_GRAPH_DONE_USER_MESSAGE)).toBe(true);
  });

  it('parses the full assistant reply (preamble + JSON) into 8 tasks and 10 edges', () => {
    const text = buildSupabasePartitionGraphAssistantMessage();
    expect(messageContainsImportableTaskGraph(text)).toBe(true);
    const parsed = parseGeneratedTasksPayload(text);
    expect(parsed.tasks).toHaveLength(8);
    expect(parsed.edges).toHaveLength(10);
    expect(parsed.tasks[0]?.graph_id).toBe(SUPABASE_PARTITION_GRAPH_JSON.graph_id);
    expect(parsed.tasks[0]?.depends_on).toEqual([]);
    expect(parsed.tasks[1]?.depends_on).toContain('Create MVP allowlist');
    const softEdge = parsed.edges.find(
      (edge) => edge.from === 'Create MVP allowlist' && edge.to === 'Edge function inventory',
    );
    expect(softEdge?.kind).toBe('fork');
    const allowlist = parsed.tasks.find((task) => task.title === 'Create MVP allowlist');
    expect(allowlist?.discovery_task_slug).toBe('sbf-create-mvp-allowlist');
    expect(allowlist?.output_type).toBe('code');
    expect(allowlist?.node_kind).toBe('work');
    const reconcile = parsed.tasks.find((task) => task.title === 'Reconcile MVP allowlist');
    expect(reconcile?.output_type).toBe('code');
    expect(reconcile?.node_kind).toBe('work');
  });

  it('reconciles depth_first session to awaitingGraphJson after GRAPH DONE + JSON', () => {
    const session: GenerateTasksSessionState = {
      sourceTaskId: 'brainstorm-root',
      phase: 'depth_first',
      layer: 1,
      activeGraphId: 'graph-active',
      activeGraphGoal: PARTITION_TITLE,
      partitionTitles: [...LAYER1_PARTITION_TITLES],
      partitionIndex: 0,
      focusPartitionTitle: PARTITION_TITLE,
      awaitingGraphJson: false,
    };
    const next = reconcileDiscoverySessionFromChat(session, discoveryChatMessages(), []);
    expect(next.awaitingGraphJson).toBe(true);
  });

  it('validates and previews mindmap graph when partition exists on the tree', () => {
    const existing = mindmapWithLayer1Partitions();
    const parsed = parseGeneratedTasksPayload(buildSupabasePartitionGraphAssistantMessage());
    const session = {
      phase: 'depth_first' as const,
      layer: 1,
      focusPartitionTitle: PARTITION_TITLE,
    };
    const drafts = prepareGeneratedDraftsForDiscovery(parsed.tasks, existing[0], session);
    const allowlist = drafts.find((draft) => draft.title === 'Create MVP allowlist');
    expect(allowlist?.depends_on).toEqual([PARTITION_TITLE]);

    const result = validateAndRepairGeneratedTasks(
      { tasks: drafts, edges: parsed.edges },
      { projectId: BATTLEPLAN_PROJECT_ID, existingTasks: existing },
    );
    expect(result.valid, result.summary).toBe(true);

    const preview = previewGraphForGeneratedTasks(drafts, result.payload.edges, existing);
    expect(preview.taskIds.size).toBeGreaterThanOrEqual(existing.length + 8);
  });

  it('advances discovery to the next Layer 1 partition after import', () => {
    const before: GenerateTasksSessionState = {
      sourceTaskId: 'brainstorm-root',
      phase: 'depth_first',
      layer: 1,
      activeGraphId: SUPABASE_PARTITION_GRAPH_JSON.graph_id,
      activeGraphGoal: PARTITION_TITLE,
      partitionTitles: [...LAYER1_PARTITION_TITLES],
      partitionIndex: 0,
      focusPartitionTitle: PARTITION_TITLE,
      awaitingGraphJson: true,
      lastImportedMessageKey: 'msg:a-graph-json',
    };
    const after = discoverySessionAfterPartitionGraphImport(before);
    expect(after.partitionIndex).toBe(1);
    expect(after.focusPartitionTitle).toBe(LAYER1_PARTITION_TITLES[1]);
    expect(after.awaitingGraphJson).toBe(false);
    expect(after.activeGraphGoal).toBe(LAYER1_PARTITION_TITLES[1]);
    expect(describeDiscoveryNextAction(after)).toMatch(/Depth-first discovery for "Next partition title"/);
  });

  it('does not treat partition graph JSON as already-imported Layer 1 partition list', () => {
    const existing = mindmapWithLayer1Partitions();
    const parsed = parseGeneratedTasksPayload(buildSupabasePartitionGraphAssistantMessage());
    expect(partitionLayerAlreadyImported(existing[0], existing, parsed)).toBe(false);
  });
});
