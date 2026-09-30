import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface Clock {
  newId: () => string;
  nowIso: () => string;
}

export const systemClock: Clock = { newId, nowIso };
