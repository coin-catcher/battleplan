import { battleplanTaskOutputsDir } from './battleplan-storage';
import type { GeneratedTasksValidationIssue } from './validate-generated-tasks';
import type { TaskDraft } from './models';
import { discoveryTaskKindContractLines } from './discovery-task-kind';

/** Stable agent-chosen slug; folder paths and JSON `id` must match. */
export function expectedDiscoveryBriefPath(projectId: string, agentTaskId: string): string {
  const id = agentTaskId.trim();
  return `${battleplanTaskOutputsDir(projectId, id)}/brief.md`;
}

export function expectedDiscoveryRepoPath(projectId: string, agentTaskId: string): string {
  return `${battleplanTaskOutputsDir(projectId, agentTaskId.trim())}/`;
}

/** Git paths use a repo project slug; Battleplan project_id may be a UUID. */
export function gitPathMatchesDiscoveryTaskSlug(gitPath: string, slug: string): boolean {
  const normalized = gitPath.replace(/\\/g, '/');
  const token = slug.trim();
  if (!token) return false;
  return normalized.includes(`/tasks/${token}/`);
}

export function normalizeDiscoveryAgentTaskId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) return undefined;
  return trimmed;
}

export function validateDiscoveryTaskCollateral(
  projectId: string,
  draft: TaskDraft & { discovery_task_slug?: string },
  index: number,
): GeneratedTasksValidationIssue[] {
  const issues: GeneratedTasksValidationIssue[] = [];
  const prefix = `tasks[${index}]`;
  const slug = draft.discovery_task_slug?.trim();
  if (!slug) {
    if (draft.brief_path || draft.git_paths?.length) {
      issues.push({
        path: `${prefix}.id`,
        message: 'Discovery tasks with brief_path must include a stable string "id" (slug) used for git folders and edges.',
      });
    }
    return issues;
  }
  const briefNorm = draft.brief_path?.trim().replace(/\\/g, '/');
  if (briefNorm && !gitPathMatchesDiscoveryTaskSlug(briefNorm, slug)) {
    issues.push({
      path: `${prefix}.brief_path`,
      message: `brief_path must be under battleplan/projects/*/tasks/${slug}/outputs/ (git project slug may differ from Battleplan project_id).`,
    });
  }
  if (draft.repo_path?.trim()) {
    const normalized = draft.repo_path.replace(/\\/g, '/').replace(/\/?$/, '/');
    if (!gitPathMatchesDiscoveryTaskSlug(`${normalized}x`, slug)) {
      issues.push({
        path: `${prefix}.repo_path`,
        message: `repo_path must be under battleplan/projects/*/tasks/${slug}/outputs/.`,
      });
    }
  }
  for (const [gitIndex, rawPath] of (draft.git_paths ?? []).entries()) {
    const path = rawPath.replace(/\\/g, '/');
    if (!gitPathMatchesDiscoveryTaskSlug(path, slug)) {
      issues.push({
        path: `${prefix}.git_paths[${gitIndex}]`,
        message: `git path must live under battleplan/projects/*/tasks/${slug}/.`,
      });
    }
  }
  return issues;
}

export const DISCOVERY_TASK_JSON_CONTRACT = [
  '## Discovery task JSON contract (git + mindmap must match)',
  '',
  'Every task in discovery JSON must use one stable **`id`** slug (kebab-case, e.g. `sbf-create-mvp-allowlist`).',
  'Battleplan creates mindmap nodes with new UUIDs; **`id` is the git folder name**, not the Battleplan task_id.',
  '',
  'Required per task (depth-first / GRAPH DONE):',
  '- `id`: stable slug',
  '- `title`: human title (3–5 words)',
  '- `brief_path`: `battleplan/projects/{repo_project_slug}/tasks/{id}/outputs/brief.md` (slug may differ from Battleplan UUID project_id)',
  '- `git_paths`: include at least that brief_path after commit',
  '- `inputs` and/or `depends_on`: upstream task **id** slugs (or titles)',
  ...discoveryTaskKindContractLines(),
  '- Optional: `pattern_id`, `outputs` (artifact names for humans; files still live under outputs/)',
  '',
  'Before JSON: commit `brief.md` (pstack fields) under each task’s `outputs/` folder on the agent branch.',
  'Battleplan imports JSON, creates local tasks, then **mirrors** those git paths from GitHub into `{BATTLEPLAN_ROOT}/battleplan/projects/…/tasks/{id}/`.',
  'Mindmap, GitHub, and local disk stay aligned when **id**, **brief_path**, and committed files agree.',
  '',
  'Top-level wrapper: `{ "graph_id", "tasks", "edges" }`. Edges use `from`/`to` id slugs; `kind`: `hard` (ordering) or `soft` (fork), or tree/ordering/fork/join/cycle.',
].join('\n');
