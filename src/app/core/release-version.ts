/** Shown in project chat; sent to the Cursor agent after develop→main release steps. */
export const VERSION_BUMP_AGENT_MESSAGE = [
  '- create a new branch off the develop branch',
  '- increment the semver version in the package.json (and package-lock.json)',
  '- commit this change to the new branch',
  '- respond with the new branch name',
].join('\n');

const BRANCH_LINE = /(?:branch\s*name|working branch|branch)\s*[:=]\s*[`"']?([^\s`"']+)/i;
const CURSOR_BRANCH = /\b(cursor\/[\w./-]+)/i;
const RELEASE_BRANCH = /\b(release\/[\w./-]+)/i;
const BACKTICK_BRANCH = /`([^\s`]+)`/;

export function parseReleaseVersionBranch(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const pattern of [BRANCH_LINE, CURSOR_BRANCH, RELEASE_BRANCH, BACKTICK_BRANCH]) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1].replace(/[.,;]+$/, '');
  }
  return null;
}
