import type { CursorClient } from '../data/cursor-browser';
import { branchNamesFromRun, pickTaskAgentBranch } from './agent-branch';
import type { Project, ProjectTask } from './models';
import { parseReleaseVersionBranch } from './release-version';
import { projectRepoSlug } from './pending-changes';
import { normalizeTaskBrief, TASK_BRIEF_FIELDS, type TaskBrief, type TaskBriefField } from './task-brief';

const DEFAULT_DEVELOP_BRANCH = 'develop';

const HEADING_FIELD: Record<string, TaskBriefField> = {
  goal: 'goal',
  scope: 'scope',
  context: 'context',
  acceptance: 'acceptance',
  verify: 'verify',
  timebox: 'timebox',
  forbidden: 'forbidden',
  report: 'report',
  standing: 'standing',
};

/** GitHub Contents API — returns decoded UTF-8 or null when missing / unreadable. */
export async function fetchGithubRepositoryFile(input: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
}): Promise<string | null> {
  const path = input.path.replace(/^\/+/, '');
  const ref = input.ref.trim();
  if (!path || !ref) return null;
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${input.token.trim()}`,
      'User-Agent': 'battleplan-desktop',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const data = await response.json() as { content?: string; encoding?: string };
  if (data.encoding !== 'base64' || typeof data.content !== 'string') return null;
  const raw = data.content.replace(/\n/g, '');
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function taskBriefFromGitFileContent(content: string, filePath: string): TaskBrief | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.json')) {
    try {
      return normalizeTaskBrief(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }
  return parseTaskBriefMarkdown(trimmed);
}

function parseTaskBriefMarkdown(markdown: string): TaskBrief | undefined {
  const sections = new Map<TaskBriefField, string[]>();
  let current: TaskBriefField | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      const key = heading[1].trim().toLowerCase().replace(/[^a-z]/g, '');
      current = HEADING_FIELD[key];
      if (current && !sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) {
      const bucket = sections.get(current)!;
      bucket.push(line);
    }
  }
  if (sections.size === 0) return undefined;
  const brief: Partial<TaskBrief> = {};
  for (const field of TASK_BRIEF_FIELDS) {
    const lines = sections.get(field);
    if (lines?.length) brief[field] = lines.join('\n').trim();
  }
  return normalizeTaskBrief(brief);
}

export async function resolveDiscoveryAgentBranch(input: {
  project: Project;
  sourceTask?: ProjectTask | null;
  cursor: CursorClient;
  replyText?: string;
  branchHint?: string;
}): Promise<string> {
  const base = input.project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
  const names = new Set<string>();
  const hint = input.branchHint?.trim();
  if (hint) names.add(hint);
  const fromReply = input.replyText ? parseReleaseVersionBranch(input.replyText) : null;
  if (fromReply) names.add(fromReply);
  const cursorBranch = input.replyText?.match(/\b(cursor\/[\w./-]+)/i)?.[1];
  if (cursorBranch) names.add(cursorBranch);

  const source = input.sourceTask;
  if (source?.cursor_agent_id) {
    try {
      const runs = await input.cursor.listRuns(source.cursor_agent_id);
      for (const summary of runs) {
        if (summary.status !== 'FINISHED' && summary.status !== 'STOPPED') continue;
        try {
          const run = await input.cursor.getRun(source.cursor_agent_id, summary.id);
          for (const name of branchNamesFromRun(run)) names.add(name);
        } catch {
          continue;
        }
      }
    } catch {
      // ignore Cursor API errors; fall back below
    }
  }

  const slug = projectRepoSlug(input.project);
  const token = input.project.github_pat?.trim();
  if (slug && names.size > 0) {
    const picked = await pickTaskAgentBranch({
      branchNames: [...names],
      preferred: hint ?? fromReply ?? cursorBranch ?? undefined,
      owner: slug.owner,
      repo: slug.repo,
      base,
      token,
    });
    if (picked?.branch) return picked.branch;
  }
  if (names.size > 0) {
    return [...names].at(-1)!;
  }
  return base;
}
