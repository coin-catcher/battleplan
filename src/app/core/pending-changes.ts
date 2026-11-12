import type { PendingChange, Project, ProjectTask, TaskCodeOutput, TaskResearchOutput } from './models';

export const DEFAULT_MAIN_BRANCH = 'main';
export const DEFAULT_DEVELOP_BRANCH = 'develop';

export function parseGithubPullRequest(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.trim().match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, ''), number: Number(match[3]) };
}

export function parseMergePullNumber(message: string): number | null {
  const match = message.match(/Merge pull request #(\d+)/i);
  return match ? Number(match[1]) : null;
}

export interface GithubPullRequest {
  merged: boolean;
  baseRef: string;
  title: string;
  body: string;
}

export interface CompareCommit {
  sha: string;
  message: string;
  html_url?: string;
}

export function releaseSourceBranch(project: Project): string {
  const explicit = project.release_source_ref?.trim();
  if (explicit) return explicit;
  const starting = project.starting_ref?.trim();
  if (starting && starting !== DEFAULT_MAIN_BRANCH) return starting;
  return DEFAULT_DEVELOP_BRANCH;
}

export function releaseTargetBranch(project: Project): string {
  return project.release_target_ref?.trim() || DEFAULT_MAIN_BRANCH;
}

export function pendingSummary(output: TaskCodeOutput | TaskResearchOutput, pull?: GithubPullRequest): string {
  const message = output.pr_message?.trim();
  if (message) return message.slice(0, 240);
  const body = pull?.body?.trim();
  if (body) return body.split('\n')[0]?.slice(0, 240) ?? 'Merged change';
  return pull?.title?.trim() || 'Merged change';
}

export function appendPendingChangeRows(current: PendingChange[], rows: PendingChange[]): PendingChange[] {
  const byId = new Map(current.map((item) => [item.change_id, item]));
  for (const row of rows) byId.set(row.change_id, row);
  return [...byId.values()].sort(
    (left, right) => right.merged_to_develop_at?.localeCompare(left.merged_to_develop_at ?? '') ?? 0,
  );
}

export function upsertPendingChange(
  current: PendingChange[],
  entry: PendingChange,
): PendingChange[] {
  const index = current.findIndex((item) => item.change_id === entry.change_id);
  if (index < 0) return [...current, entry];
  const next = [...current];
  next[index] = entry;
  return next;
}

interface TaskPullMatch {
  taskId: string;
  title: string;
  summary: string;
  prLink: string;
}

function buildTaskPullIndex(
  tasks: ProjectTask[],
  codeOutputs: Record<string, TaskCodeOutput | null>,
  researchOutputs: Record<string, TaskResearchOutput | null>,
): Map<number, TaskPullMatch> {
  const index = new Map<number, TaskPullMatch>();
  for (const task of tasks) {
    const output = task.output_type === 'code'
      ? codeOutputs[task.task_id]
      : task.output_type === 'research'
        ? researchOutputs[task.task_id]
        : null;
    if (!output?.pr_link) continue;
    const parsed = parseGithubPullRequest(output.pr_link);
    if (!parsed) continue;
    index.set(parsed.number, {
      taskId: task.task_id,
      title: task.title,
      summary: pendingSummary(output),
      prLink: output.pr_link,
    });
  }
  return index;
}

function firstLine(message: string): string {
  return message.split('\n')[0]?.trim() || 'Change';
}

export async function buildPendingChangesFromCommits(input: {
  owner: string;
  repo: string;
  commits: CompareCommit[];
  tasks: ProjectTask[];
  codeOutputs: Record<string, TaskCodeOutput | null>;
  researchOutputs: Record<string, TaskResearchOutput | null>;
  loadPull: (number: number) => Promise<GithubPullRequest | null>;
}): Promise<PendingChange[]> {
  if (input.commits.length === 0) return [];

  const taskByPull = buildTaskPullIndex(input.tasks, input.codeOutputs, input.researchOutputs);
  const pullCache = new Map<number, GithubPullRequest | null>();
  const next: PendingChange[] = [];
  const timestamp = new Date().toISOString();
  const { owner, repo } = input;

  for (const commit of input.commits) {
    const prNumber = parseMergePullNumber(commit.message);
    let pull: GithubPullRequest | null = null;
    if (prNumber !== null) {
      if (!pullCache.has(prNumber)) {
        pullCache.set(prNumber, await input.loadPull(prNumber));
      }
      pull = pullCache.get(prNumber) ?? null;
    }

    const taskMatch = prNumber !== null ? taskByPull.get(prNumber) : undefined;
    const headline = firstLine(commit.message);
    const prLink = taskMatch?.prLink
      ?? (prNumber !== null ? `https://github.com/${owner}/${repo}/pull/${prNumber}` : commit.html_url);

    next.push({
      change_id: commit.sha,
      task_id: taskMatch?.taskId ?? '',
      task_title: taskMatch?.title ?? pull?.title ?? headline,
      summary: (taskMatch?.summary ?? pull?.title ?? headline).slice(0, 240),
      pr_link: prLink,
      merged_to_develop_at: timestamp,
    });
  }

  return next.sort((left, right) => right.merged_to_develop_at?.localeCompare(left.merged_to_develop_at ?? '') ?? 0);
}

export function projectRepoSlug(project: Project): { owner: string; repo: string } | null {
  const url = project.repo_url?.trim();
  if (!url) return null;
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const match = normalized.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

export const POST_MAIN_MERGE_PROJECT_MESSAGE =
  'a PR was merged to main branch. create a list of recent changes merged to main';
