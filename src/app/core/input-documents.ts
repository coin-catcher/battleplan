import type { ProjectTask, TaskOutputManifest } from './models';

export function collectUpstreamTaskIds(task: ProjectTask, all: ProjectTask[]): string[] {
  const byId = new Map(all.map((t) => [t.task_id, t]));
  const upstream = new Set<string>();
  for (const parent of all) {
    if (parent.dependencies.includes(task.task_id)) {
      upstream.add(parent.task_id);
    }
  }
  for (const peerId of task.sibling_dependencies ?? []) {
    upstream.add(peerId);
  }
  return [...upstream].filter((id) => byId.has(id));
}

export function buildInputDocumentsSection(task: ProjectTask, all: ProjectTask[]): string {
  const upstreamIds = collectUpstreamTaskIds(task, all);
  if (!upstreamIds.length) return '';
  const lines: string[] = ['INPUT DOCUMENTS (from connected upstream tasks):'];
  for (const id of upstreamIds) {
    const upstream = all.find((t) => t.task_id === id);
    if (!upstream) continue;
    const folder = upstream.repo_path?.trim() || `(task ${id} — no repo_path)`;
    lines.push(`- ${upstream.title} (${id}): folder \`${folder}\``);
    const manifest = upstream.output_manifest;
    if (manifest?.entries?.length) {
      for (const entry of manifest.entries) {
        lines.push(`  - \`${entry.path}\`${entry.description ? `: ${entry.description}` : ''}`);
      }
    }
  }
  return lines.join('\n');
}

export function mergeOutputManifest(
  existing: TaskOutputManifest | undefined,
  entries: TaskOutputManifest['entries'],
): TaskOutputManifest {
  return {
    entries: [...(existing?.entries ?? []), ...entries],
    updated_at: new Date().toISOString(),
  };
}
