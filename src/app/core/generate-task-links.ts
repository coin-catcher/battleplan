import type { ProjectTask, Selection, TaskDraft } from './models';
import { pickPrimaryParentId } from './dependencies';

export function generateTasksSourceTaskId(selection: Selection): string | undefined {
  if (selection.kind === 'task' || selection.kind === 'subproject' || selection.kind === 'code' || selection.kind === 'research') {
    return selection.taskId;
  }
  return undefined;
}

/** Attach generated tasks with no tree parent under the task that invoked Generate Tasks. */
export function linkCreatedTasksUnderParent(
  existing: ProjectTask[],
  created: ProjectTask[],
  parentTaskId: string,
): void {
  const parent = [...existing, ...created].find((task) => task.task_id === parentTaskId);
  if (!parent) return;
  const all = [...existing, ...created];
  for (const child of created) {
    if (child.task_id === parentTaskId) continue;
    if (pickPrimaryParentId(child.task_id, all)) continue;
    if (!parent.dependencies.includes(child.task_id)) {
      parent.dependencies = [...parent.dependencies, child.task_id];
    }
  }
}

export interface SequentialDraft {
  sequential_with: string[];
}

export function bindSequentialDraftLinks(
  existing: ProjectTask[],
  created: ProjectTask[],
  drafts: SequentialDraft[],
): void {
  const titles = new Map<string, string[]>();
  for (const task of [...existing, ...created]) {
    const ids = titles.get(task.title) ?? [];
    ids.push(task.task_id);
    titles.set(task.title, ids);
  }
  const pairs = new Map<string, Set<string>>();
  const addPair = (leftId: string, rightId: string): void => {
    if (leftId === rightId) return;
    const set = pairs.get(leftId) ?? new Set<string>();
    set.add(rightId);
    pairs.set(leftId, set);
  };
  const indexById = new Map(created.map((task, index) => [task.task_id, index]));
  created.forEach((task, index) => {
    for (const title of drafts[index]?.sequential_with ?? []) {
      const matches = titles.get(title.trim()) ?? [];
      if (matches.length !== 1) continue;
      const otherId = matches[0];
      const otherIndex = indexById.get(otherId);
      if (otherIndex === undefined || otherIndex === index) continue;
      // Later tasks in the batch wait for earlier ones (one-way ordering avoids graph cycles).
      if (index > otherIndex) {
        addPair(task.task_id, otherId);
      }
    }
  });
  for (const task of created) {
    const peerIds = pairs.get(task.task_id);
    if (!peerIds?.size) continue;
    task.sibling_dependencies = [...new Set([...(task.sibling_dependencies ?? []), ...peerIds])];
  }
}

/** Prefer task-id anchoring; keep title-based depends_on fill as a fallback for the agent JSON. */
/** Wire draft depends_on titles to parent.dependencies → child task ids (mindmap tree). */
export function bindDraftDependsOn(
  existing: ProjectTask[],
  created: ProjectTask[],
  drafts: Pick<TaskDraft, 'depends_on'>[],
): void {
  const titles = new Map<string, string[]>();
  for (const task of [...existing, ...created]) {
    const ids = titles.get(task.title) ?? [];
    ids.push(task.task_id);
    titles.set(task.title, ids);
  }
  const byId = new Map([...existing, ...created].map((task) => [task.task_id, task]));
  created.forEach((task) => {
    task.dependencies = [];
  });
  created.forEach((task, index) => {
    for (const title of drafts[index]?.depends_on ?? []) {
      const matches = titles.get(title) ?? [];
      if (matches.length === 0) throw new Error(`Unknown dependency "${title}".`);
      if (matches.length > 1) throw new Error(`Dependency "${title}" matches more than one task.`);
      const parent = byId.get(matches[0]);
      if (!parent) throw new Error(`Unknown dependency "${title}".`);
      parent.dependencies = [...new Set([...parent.dependencies, task.task_id])];
    }
  });
}

export function prepareGeneratedDrafts(
  drafts: TaskDraft[],
  sourceTask: ProjectTask | undefined,
): TaskDraft[] {
  return prepareGeneratedDraftsForLayer(drafts, sourceTask, 1);
}

/** Layer 1 anchors empty depends_on under the source task; deeper layers keep agent depends_on. */
export function prepareGeneratedDraftsForLayer(
  drafts: TaskDraft[],
  sourceTask: ProjectTask | undefined,
  layer: number,
): TaskDraft[] {
  if (layer > 1 || !sourceTask) return drafts;
  const parentTitle = sourceTask.title.trim();
  if (!parentTitle) return drafts;
  return drafts.map((draft) => ({
    ...draft,
    depends_on: (draft.depends_on ?? []).filter(Boolean).length > 0 ? draft.depends_on : [parentTitle],
  }));
}
