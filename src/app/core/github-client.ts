import { projectRepoSlug } from './pending-changes';

export interface GithubAuth {
  token: string;
}

export interface GithubCompareCommit {
  sha: string;
  message: string;
  html_url?: string;
}

export interface GithubPullRequestRef {
  number: number;
  html_url: string;
}

function authHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'battleplan-desktop',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubJson<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(token), ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { message: text };
    }
  }
  if (!response.ok) {
    const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const message = typeof record['message'] === 'string' ? record['message'] : text || response.statusText;
    const error = new Error(`GitHub API ${response.status}: ${message}`);
    if (isGithubMergeConflictMessage(response.status, message)) {
      error.name = 'GithubMergeConflictError';
    }
    throw error;
  }
  return parsed as T;
}

export function requireProjectGithubPat(project: { github_pat?: string }): string {
  const token = project.github_pat?.trim();
  if (!token) throw new Error('Add a GitHub personal access token on the project before running GitHub operations.');
  return token;
}

export async function compareBranches(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token: string,
): Promise<{ ahead_by: number; commits: GithubCompareCommit[] }> {
  const data = await githubJson<{
    ahead_by?: number;
    commits?: Array<{ sha: string; html_url?: string; commit: { message: string } }>;
  }>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );
  return {
    ahead_by: data.ahead_by ?? 0,
    commits: (data.commits ?? []).map((item) => ({
      sha: item.sha,
      html_url: item.html_url,
      message: item.commit.message,
    })),
  };
}

export async function listPullCommits(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<GithubCompareCommit[]> {
  const data = await githubJson<Array<{ sha: string; html_url?: string; commit: { message: string } }>>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/commits?per_page=100`,
  );
  return data.map((item) => ({
    sha: item.sha,
    html_url: item.html_url,
    message: item.commit.message,
  }));
}

export async function findOpenPullRequest(
  owner: string,
  repo: string,
  headBranch: string,
  baseBranch: string,
  token: string,
): Promise<GithubPullRequestRef | null> {
  const data = await githubJson<Array<{ number: number; html_url: string; head: { ref?: string }; base: { ref?: string }; state?: string }>>(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${headBranch}`)}&base=${encodeURIComponent(baseBranch)}&per_page=5`,
  );
  const match = data.find((item) => item.head?.ref === headBranch && item.base?.ref === baseBranch);
  if (!match) return null;
  return { number: match.number, html_url: match.html_url };
}

export async function createPullRequest(input: {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  token: string;
}): Promise<GithubPullRequestRef> {
  const compare = await compareBranches(input.owner, input.repo, input.base, input.head, input.token);
  if (compare.ahead_by <= 0) {
    throw new Error(
      `Branch "${input.head}" has no commits ahead of "${input.base}". `
      + 'The agent may have pushed to a different branch; open the task output and confirm the branch name, or re-run the agent with the single-branch policy.',
    );
  }
  const existing = await findOpenPullRequest(input.owner, input.repo, input.head, input.base, input.token);
  if (existing) return existing;
  const data = await githubJson<{ number: number; html_url: string }>(
    input.token,
    `https://api.github.com/repos/${input.owner}/${input.repo}/pulls`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        body: input.body ?? '',
        head: input.head,
        base: input.base,
      }),
    },
  );
  return { number: data.number, html_url: data.html_url };
}

export function isGithubMergeConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'GithubMergeConflictError') return true;
  return isGithubMergeConflictMessage(undefined, error.message);
}

function isGithubMergeConflictMessage(status: number | undefined, message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes('merge conflict')) return false;
  if (status === 405 || status === 409 || status === 422) return true;
  return normalized.includes('github api 405')
    || normalized.includes('github api 409')
    || normalized.includes('github api 422');
}

export const MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL = 'sent the Cursor agent instructions to merge the base branch';

export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<void> {
  await githubJson(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: 'merge' }),
    },
  );
}

export async function createAndMergePullRequest(input: {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  token: string;
}): Promise<{ pull: GithubPullRequestRef; commits: GithubCompareCommit[] }> {
  const pull = await createPullRequest(input);
  await mergePullRequest(input.owner, input.repo, pull.number, input.token);
  const commits = await listPullCommits(input.owner, input.repo, pull.number, input.token);
  return { pull, commits };
}

export function repoSlugFromProject(project: { repo_url?: string }): { owner: string; repo: string } {
  const slug = projectRepoSlug(project as import('./models').Project);
  if (!slug) throw new Error('Add a repository URL to the project.');
  return slug;
}
