import type { CursorClient } from '../data/cursor-browser';
import { branchNamesFromRun, pickTaskAgentBranch } from './agent-branch';
import type { Project, ProjectTask } from './models';
import { parseReleaseVersionBranch } from './release-version';
import { projectRepoSlug } from './pending-changes';
import { assertBattleplanGitMirrorPath, normalizeGitMirrorRelativePath, repoFolderFromDraftPaths } from './git-mirror-path';
import { normalizeTaskBrief, TASK_BRIEF_FIELDS, type TaskBrief, type TaskBriefField } from './task-brief';

const DEFAULT_DEVELOP_BRANCH = 'develop';

type GithubContentsEntry = {
  path?: string;
  type?: 'file' | 'dir' | 'symlink' | 'submodule';
  content?: string;
  encoding?: string;
  download_url?: string;
};

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

function githubContentsUrl(owner: string, repo: string, filePath: string, ref: string): string {
  const path = normalizeGitMirrorRelativePath(filePath);
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
}

function githubAuthHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token.trim()}`,
    'User-Agent': 'battleplan-desktop',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function decodeGithubBase64Content(content: string): string | null {
  const raw = content.replace(/\n/g, '');
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

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
  const response = await fetch(githubContentsUrl(input.owner, input.repo, path, ref), {
    headers: githubAuthHeaders(input.token),
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const data = await response.json() as GithubContentsEntry;
  if (data.encoding !== 'base64' || typeof data.content !== 'string') return null;
  return decodeGithubBase64Content(data.content);
}

async function listGithubRepositoryFiles(input: {
  token: string;
  owner: string;
  repo: string;
  folderPath: string;
  ref: string;
}): Promise<string[]> {
  const folder = input.folderPath.replace(/^\/+/, '').replace(/\/?$/, '');
  if (!folder) return [];
  const response = await fetch(githubContentsUrl(input.owner, input.repo, folder, input.ref), {
    headers: githubAuthHeaders(input.token),
  });
  if (response.status === 404) return [];
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data)) {
    return typeof (data as GithubContentsEntry)?.path === 'string' ? [(data as GithubContentsEntry).path!] : [];
  }
  const paths: string[] = [];
  for (const entry of data as GithubContentsEntry[]) {
    if (!entry.path) continue;
    if (entry.type === 'file') paths.push(entry.path);
    else if (entry.type === 'dir') {
      paths.push(...await listGithubRepositoryFiles({ ...input, folderPath: entry.path }));
    }
  }
  return paths;
}

export interface SyncGithubBattleplanFolderInput {
  token: string;
  owner: string;
  repo: string;
  ref: string;
  folderPath: string;
  writeMirrorFile: (gitRelativePath: string, content: string) => Promise<void>;
}

/** Download every file under a git folder and write into the local battleplan/ mirror. */
export async function syncGithubBattleplanFolder(input: SyncGithubBattleplanFolderInput): Promise<string[]> {
  const folder = assertBattleplanGitMirrorPath(input.folderPath.replace(/\/?$/, ''));
  const filePaths = await listGithubRepositoryFiles({
    token: input.token,
    owner: input.owner,
    repo: input.repo,
    folderPath: folder,
    ref: input.ref,
  });
  const synced: string[] = [];
  for (const filePath of filePaths) {
    const normalized = assertBattleplanGitMirrorPath(filePath);
    if (!normalized.startsWith(folder)) continue;
    const content = await fetchGithubRepositoryFile({
      token: input.token,
      owner: input.owner,
      repo: input.repo,
      path: normalized,
      ref: input.ref,
    });
    if (content === null) continue;
    await input.writeMirrorFile(normalized, content);
    synced.push(normalized);
  }
  return synced;
}

export function pickBriefPathFromSynced(syncedPaths: string[], briefPathHint?: string): string | undefined {
  const hint = briefPathHint?.trim();
  if (hint && syncedPaths.includes(hint.replace(/\\/g, '/'))) return hint.replace(/\\/g, '/');
  const lower = syncedPaths.map((p) => p.toLowerCase());
  const briefMd = syncedPaths.find((_, i) => lower[i]?.endsWith('/brief.md') || lower[i]?.endsWith('brief.md'));
  if (briefMd) return briefMd;
  return syncedPaths.find((p) => p.toLowerCase().endsWith('task-brief.json'));
}

export function collateralFolderForDraft(draft: { repo_path?: string; brief_path?: string }): string | undefined {
  return repoFolderFromDraftPaths(draft.repo_path, draft.brief_path);
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
