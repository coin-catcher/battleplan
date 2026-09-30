import { HttpCursorClient, type CursorClient } from './cursor-client.js';
import { DynamoRepository } from './dynamo-repository.js';
import type { WarplanRepository } from './repository.js';

export interface ServiceDeps {
  repo: WarplanRepository;
  cursor: CursorClient;
}

export function createDefaultDeps(): ServiceDeps {
  const tableName = process.env.WARPLAN_TABLE_NAME;
  if (!tableName) {
    throw new Error('WARPLAN_TABLE_NAME is required');
  }
  return {
    repo: new DynamoRepository(tableName),
    cursor: new HttpCursorClient({
      apiKey: process.env.CURSOR_API_KEY ?? '',
      baseUrl: process.env.CURSOR_API_BASE,
    }),
  };
}
