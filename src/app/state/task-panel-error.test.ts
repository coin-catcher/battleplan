import { describe, expect, it } from 'vitest';

function upsertTaskPanelError(
  record: Record<string, { message: string; connectionFailed: boolean }>,
  taskId: string,
  error: { message: string; connectionFailed: boolean } | null,
): Record<string, { message: string; connectionFailed: boolean }> {
  const next = { ...record };
  if (error) next[taskId] = error;
  else delete next[taskId];
  return next;
}

describe('task panel error map', () => {
  it('stores errors per task id independently', () => {
    let record = upsertTaskPanelError({}, 't1', { message: 'A', connectionFailed: true });
    record = upsertTaskPanelError(record, 't2', { message: 'B', connectionFailed: false });
    expect(record.t1?.message).toBe('A');
    expect(record.t2?.message).toBe('B');
    record = upsertTaskPanelError(record, 't1', null);
    expect(record.t1).toBeUndefined();
    expect(record.t2?.message).toBe('B');
  });
});
