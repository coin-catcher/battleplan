/** Git-relative paths under battleplan/ mirrored under each project's BATTLEPLAN_ROOT folder. */

export function normalizeGitMirrorRelativePath(gitPath: string): string {
  const normalized = gitPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw new Error(`Invalid git mirror path: ${gitPath}`);
    parts.push(segment);
  }
  return parts.join('/');
}

export function assertBattleplanGitMirrorPath(gitPath: string): string {
  const normalized = normalizeGitMirrorRelativePath(gitPath);
  if (!normalized.startsWith('battleplan/')) {
    throw new Error(`Git mirror paths must start with battleplan/ (got ${gitPath}).`);
  }
  return normalized;
}

/** Folder path for task collateral (trailing slash). */
export function repoFolderFromDraftPaths(repoPath?: string, briefPath?: string): string | undefined {
  const fromRepo = repoPath?.trim().replace(/\/?$/, '/');
  if (fromRepo) return fromRepo;
  if (!briefPath?.trim()) return undefined;
  const normalized = briefPath.replace(/\\/g, '/');
  if (normalized.endsWith('/brief.md')) return normalized.slice(0, -'brief.md'.length);
  if (normalized.endsWith('brief.md')) return normalized.slice(0, -'brief.md'.length);
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? `${normalized.slice(0, idx + 1)}` : undefined;
}
