import type { PendingChange, Project, ProjectTask, TaskCodeOutput, TaskResearchOutput } from './models';

export function parseGithubPullRequest(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.trim().match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, ''), number: Number(match[3]) };
}

export interface GithubPullRequest {
  merged: boolean;
  baseRef: string;
  title: string;
  body: string;
}

export async function fetchGithubPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<GithubPullRequest | null> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'battleplan-desktop' },
  });
  if (!response.ok) return null;
  const payload = response.json() as Promise<{
    merged?: boolean;
    base?: { ref?: string };
    title?: string;
    body?: string | null;
  }>;
  const data = await payload;
  return {
    merged: Boolean(data.merged),
    baseRef: data.base?.ref ?? '',
    title: data.title ?? '',
    body: data.body ?? '',
  };
}

/** True when develop has no commits that main is missing (develop fully merged into main). */
export async function isDevelopMergedIntoMain(owner: string, repo: string): Promise<boolean> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/compare/main...develop`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'battleplan-desktop' },
  });
  if (!response.ok) return false;
  const data = await response.json() as { ahead_by?: number };
  return (data.ahead_by ?? 0) === 0;
}

export function pendingSummary(output: TaskCodeOutput | TaskResearchOutput, pull?: GithubPullRequest): string {
  const message = output.pr_message?.trim();
  if (message) return message.slice(0, 240);
  const body = pull?.body?.trim();
  if (body) return body.split('\n')[0]?.slice(0, 240) ?? 'Merged change';
  return pull?.title?.trim() || 'Merged change';
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

export async function syncPendingChangesForProject(input: {
  project: Project;
  tasks: ProjectTask[];
  codeOutputs: Record<string, TaskCodeOutput | null>;
  researchOutputs: Record<string, TaskResearchOutput | null>;
  current: PendingChange[];
}): Promise<PendingChange[]> {
  const slug = projectRepoSlug(input.project);
  if (!slug) return input.current;
  const { owner, repo } = slug;

  if (await isDevelopMergedIntoMain(owner, repo)) return [];

  let next = [...input.current];
  for (const task of input.tasks) {
    const output = task.output_type === 'code'
      ? input.codeOutputs[task.task_id]
      : input.researchOutputs[task.task_id];
    if (!output?.pr_link) continue;
    const link = parseGithubPullRequest(output.pr_link);
    if (!link) continue;
    const pull = await fetchGithubPullRequest(link.owner, link.repo, link.number);
    if (!pull?.merged) continue;
    const developBranch = input.project.starting_ref?.trim() || 'develop';
    const mergedToDevelop = pull.baseRef === developBranch || pull.baseRef === 'develop';
    const mergedToMain = pull.baseRef === 'main' || pull.baseRef === 'master';
    const changeId = `${task.task_id}:${link.number}`;
    if (mergedToMain) {
      next = next.filter((item) => item.change_id !== changeId);
      continue;
    }
    if (mergedToDevelop) {
      next = upsertPendingChange(next, {
        change_id: changeId,
        task_id: task.task_id,
        task_title: task.title,
        summary: pendingSummary(output, pull),
        pr_link: output.pr_link,
        merged_to_develop_at: new Date().toISOString(),
      });
    }
  }
  return next;
}

export function projectRepoSlug(project: Project): { owner: string; repo: string } | null {
  const url = project.repo_url?.trim();
  if (!url) return null;
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const match = normalized.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

export const RELEASE_CHANGES_MESSAGE = [
  'release the changes in development:',
  '- create a new branch off the develop branch',
  '- bump the version in package.json',
  '- create a PR that will merge the new branch into develop',
  '- approve the PR and merge this new branch into develop',
  '- create a PR that will merge the develop branch into the main branch',
  '- approve the PR and merge the develop branch into the main branch',
].join('\n');
