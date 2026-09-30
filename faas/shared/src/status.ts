import type { TaskStatus } from './domain.js';
import { isTaskStatus } from './domain.js';
import { HttpError } from './errors.js';

const GUIDED: Record<TaskStatus, TaskStatus[]> = {
  TODO: ['DOING', 'ABANDONED'],
  DOING: ['REVIEW', 'DONE', 'ABANDONED'],
  REVIEW: ['DOING', 'DONE', 'ABANDONED'],
  DONE: [],
  ABANDONED: [],
};

export function guidedTransitions(from: TaskStatus): TaskStatus[] {
  return [...GUIDED[from]];
}

export function assertCanTransition(from: TaskStatus, to: TaskStatus, manual: boolean): void {
  if (!isTaskStatus(to)) {
    throw new HttpError(400, 'Unknown task status.');
  }
  if (from === to) return;
  if (manual) return;
  if (!GUIDED[from].includes(to)) {
    throw new HttpError(
      400,
      `Cannot move a task from ${from} to ${to}. Expected one of: ${GUIDED[from].join(', ') || 'a manual change'}.`,
    );
  }
}
