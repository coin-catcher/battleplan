import type { ChatArtifact, TaskDraft } from './models';

export function parseGeneratedTaskListFromSources(text: string, artifacts: ChatArtifact[]): TaskDraft[] {
  const errors: string[] = [];
  try {
    return parseGeneratedTaskList(text);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Could not parse agent text.');
  }
  for (const artifact of artifacts) {
    if (artifact.content_type !== 'text' || !artifact.text?.trim()) continue;
    if (!/\.json$/i.test(artifact.name) && !artifact.text.trim().startsWith('[')) continue;
    try {
      return parseGeneratedTaskList(artifact.text);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Could not parse artifact text.');
    }
  }
  throw new Error(errors[0] ?? 'No JSON task array found in the agent response.');
}

export function parseGeneratedTaskList(text: string): TaskDraft[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new Error('No JSON task array found in the agent response.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  } catch {
    throw new Error('The agent response did not contain valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('The task list is empty.');
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Task ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const title = requiredText(record['title'], `Task ${index + 1} title`);
    const prompt = requiredText(record['prompt'], `Task ${index + 1} prompt`);
    const output = record['output_type'];
    if (typeof output !== 'string' || !output.trim()) {
      throw new Error(`Task ${index + 1} output_type is required.`);
    }
    const depends = record['depends_on'] ?? record['dependencies'] ?? [];
    if (!Array.isArray(depends) || depends.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Task ${index + 1} depends_on must be an array of task titles.`);
    }
    return {
      title,
      prompt,
      output_type: output.trim(),
      depends_on: depends.map((entry) => entry.trim()).filter(Boolean),
    };
  });
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}
