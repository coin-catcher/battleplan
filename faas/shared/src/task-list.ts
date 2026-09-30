import type { NormalizedTaskDraft, OutputType } from './domain.js';
import { HttpError } from './errors.js';

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${label} is required.`);
  }
  return value.trim();
}

function dependsOn(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HttpError(400, `${label} must be an array of task titles.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function outputTypesOf(value: unknown, label: string): OutputType[] {
  const raw = Array.isArray(value) ? value : [value];
  const tokens = raw
    .flatMap((item) => (typeof item === 'string' ? item.split(/[+,/]/) : []))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new HttpError(400, `${label} must be "code" or "research".`);
  }

  const types = new Set<OutputType>();
  for (const token of tokens) {
    if (token === 'both' || token === 'code+research' || token === 'research+code') {
      types.add('research');
      types.add('code');
      continue;
    }
    if (token !== 'code' && token !== 'research') {
      throw new HttpError(400, `${label} must be "code" or "research".`);
    }
    types.add(token);
  }
  return [...types];
}

export function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new HttpError(400, 'No JSON task array found in the agent response.');
  }
  try {
    return JSON.parse(source.slice(start, end + 1)) as unknown;
  } catch {
    throw new HttpError(400, 'The agent response did not contain valid JSON.');
  }
}

export function normalizeTaskDrafts(raw: unknown[]): NormalizedTaskDraft[] {
  if (raw.length === 0) {
    throw new HttpError(400, 'The task list is empty.');
  }
  const normalized: NormalizedTaskDraft[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, `Task ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const title = requiredText(record.title, `Task ${index + 1} title`);
    const prompt = requiredText(record.prompt, `Task ${index + 1} prompt`);
    const depends = dependsOn(record.depends_on ?? record.dependencies, `Task ${index + 1} depends_on`);
    const types = outputTypesOf(record.output_type, `Task ${index + 1} output_type`);
    if (types.length === 1) {
      normalized.push({ title, prompt, output_type: types[0], depends_on: depends });
      return;
    }
    const researchTitle = `${title} (research)`;
    const codeTitle = `${title} (code)`;
    normalized.push({
      title: researchTitle,
      prompt: `${prompt}\n\nProduce only the research output for this task.`,
      output_type: 'research',
      depends_on: depends,
    });
    normalized.push({
      title: codeTitle,
      prompt: `${prompt}\n\nProduce only the code output for this task, using the companion research task as input.`,
      output_type: 'code',
      depends_on: [...depends, researchTitle],
    });
  });
  return normalized;
}

export function parseGeneratedTaskList(text: string): NormalizedTaskDraft[] {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) {
    throw new HttpError(400, 'Task list must be a JSON array.');
  }
  return normalizeTaskDrafts(parsed);
}
