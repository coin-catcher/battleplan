import type { CursorGitBranch, CursorRun } from '../data/cursor-browser';
import { compareBranches } from './github-client';

export function branchNamesFromRun(run: CursorRun | undefined): string[] {
  const names: string[] = [];
  for (const entry of run?.git?.branches ?? []) {
    if (entry.branch?.trim()) names.push(entry.branch.trim());
  }
  return [...new Set(names)];
}

export async function pickTaskAgentBranch(input: {
  branchNames: string[];
  preferred?: string;
  owner: string;
  repo: string;
  base: string;
  token?: string;
}): Promise<{ branch: string; aheadBy: number } | null> {
  const candidates = [...new Set(input.branchNames.map((name) => name.trim()).filter(Boolean))];
  if (candidates.length === 0) return null;

  const preferred = input.preferred?.trim();
  if (!input.token?.trim()) {
    const branch = preferred && candidates.includes(preferred)
      ? preferred
      : candidates[candidates.length - 1];
    return { branch, aheadBy: 1 };
  }

  const token = input.token.trim();
  const scored: Array<{ branch: string; aheadBy: number }> = [];
  for (const branch of candidates) {
    try {
      const compare = await compareBranches(input.owner, input.repo, input.base, branch, token);
      scored.push({ branch, aheadBy: compare.ahead_by });
    } catch {
      scored.push({ branch, aheadBy: -1 });
    }
  }

  const withCommits = scored.filter((item) => item.aheadBy > 0);
  if (withCommits.length === 0) {
    const fallback = preferred && candidates.includes(preferred) ? preferred : candidates[candidates.length - 1];
    const match = scored.find((item) => item.branch === fallback);
    return { branch: fallback, aheadBy: match?.aheadBy ?? 0 };
  }

  withCommits.sort((left, right) => {
    if (right.aheadBy !== left.aheadBy) return right.aheadBy - left.aheadBy;
    if (preferred) {
      if (left.branch === preferred) return -1;
      if (right.branch === preferred) return 1;
    }
    return 0;
  });
  return withCommits[0];
}

export function agentBranchPolicyLines(input: {
  baseBranch: string;
  agentBranch?: string;
}): string[] {
  const base = input.baseBranch.trim() || 'develop';
  const lines = [
    'Git workflow (required):',
    `- Use exactly one branch for this Cursor agent for all work${input.agentBranch ? `: \`${input.agentBranch}\`` : ''}.`,
    '- Do not create additional branches or fork new agent branches.',
    `- Before writing or committing code, merge the latest \`${base}\` branch into your working branch if your branch is behind.`,
    '- Commit and push all changes to that single branch only.',
    '- Do not create, update, or merge pull requests (no `gh pr`, no ManagePullRequest, no GitHub PR tools). Battleplan opens and merges PRs after human review.',
    '- In your final reply, state which branch contains your commits.',
  ];
  return lines;
}

export function mergeConflictRecoveryPrompt(input: {
  baseBranch: string;
  agentBranch: string;
}): string {
  const base = input.baseBranch.trim() || 'develop';
  const branch = input.agentBranch.trim();
  return [
    `Battleplan could not merge your pull request into \`${base}\` because GitHub reported merge conflicts (the base branch may have moved forward).`,
    `Merge the latest \`${base}\` branch into your working branch${branch ? ` (\`${branch}\`)` : ''}.`,
    'Resolve all merge conflicts, commit the merge, and push to your working branch.',
    'In your reply, summarize which files conflicted and how you resolved them.',
    'Do not open or merge pull requests; Battleplan will run Approve and merge again after your push.',
  ].join('\n\n');
}

export function wrapAgentRunPrompt(
  body: string,
  policy: { baseBranch: string; agentBranch?: string },
): string {
  const trimmed = body.trim();
  const header = agentBranchPolicyLines(policy).join('\n');
  return `${header}\n\n${trimmed}`;
}

export function pickBranchInfoFromRun(
  branches: CursorGitBranch[] | undefined,
  preferredBranch?: string,
): CursorGitBranch | undefined {
  const list = branches ?? [];
  if (list.length === 0) return undefined;
  if (preferredBranch) {
    const match = list.find((item) => item.branch?.trim() === preferredBranch.trim());
    if (match) return match;
  }
  return list[list.length - 1];
}
