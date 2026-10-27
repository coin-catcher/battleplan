import type { ProjectTask, TaskDraft } from './models';

export interface CrossGraphTaskUpdate {
  task_id: string;
  title?: string;
  prompt?: string;
  output_type?: TaskDraft['output_type'];
  node_kind?: TaskDraft['node_kind'];
  graph_id?: string;
  pattern_id?: string;
  cross_graph_edit_rationale?: string;
}

export function splitDiscoveryDrafts(
  drafts: TaskDraft[],
  existing: ProjectTask[],
): { creates: TaskDraft[]; updates: CrossGraphTaskUpdate[] } {
  const byTitle = new Map<string, ProjectTask[]>();
  for (const task of existing) {
    const key = task.title.trim();
    const list = byTitle.get(key) ?? [];
    list.push(task);
    byTitle.set(key, list);
  }

  const creates: TaskDraft[] = [];
  const updates: CrossGraphTaskUpdate[] = [];

  for (const draft of drafts) {
    const title = draft.title.trim();
    const matches = byTitle.get(title) ?? [];
    if (draft.cross_graph_edit && matches.length === 1) {
      const target = matches[0];
      updates.push({
        task_id: target.task_id,
        title: draft.title,
        prompt: draft.prompt,
        output_type: draft.output_type,
        node_kind: draft.node_kind,
        graph_id: draft.graph_id ?? target.graph_id,
        pattern_id: draft.pattern_id,
        cross_graph_edit_rationale: draft.cross_graph_edit_rationale,
      });
      continue;
    }
    if (draft.cross_graph_edit && matches.length > 1) {
      throw new Error(`cross_graph_edit target "${title}" matches more than one task.`);
    }
    creates.push(draft);
  }

  return { creates, updates };
}
