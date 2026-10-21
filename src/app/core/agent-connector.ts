/** Battleplan task statuses (duplicated here to avoid circular imports with models.ts). */
export type BattleplanTaskStatus =
  | 'TODO'
  | 'DOING'
  | 'REVIEW'
  | 'BLOCKED'
  | 'DONE'
  | 'ABANDONED';

/** Execution backends Battleplan can release work to. */
export const CONNECTOR_KINDS = ['cursor', 'hermes', 'research_http', 'custom'] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export interface AgentConnectorConfig {
  connector_id: string;
  kind: ConnectorKind;
  name: string;
  endpoint?: string;
  max_in_progress?: number;
  healthy?: boolean;
}

/** Hermes kanban / gateway statuses observed over task_events. */
export const HERMES_RUN_STATUSES = [
  'triage',
  'todo',
  'ready',
  'running',
  'review',
  'blocked',
  'done',
  'archived',
] as const;
export type HermesRunStatus = (typeof HERMES_RUN_STATUSES)[number];

const HERMES_TO_BATTLEPLAN: Record<HermesRunStatus, BattleplanTaskStatus | undefined> = {
  triage: 'TODO',
  todo: 'TODO',
  ready: 'TODO',
  running: 'DOING',
  review: 'REVIEW',
  blocked: 'BLOCKED',
  done: 'DONE',
  archived: 'ABANDONED',
};

export function mapHermesStatusToBattleplan(status: string): BattleplanTaskStatus | undefined {
  const key = status.trim().toLowerCase() as HermesRunStatus;
  if (!(HERMES_RUN_STATUSES as readonly string[]).includes(key)) return undefined;
  return HERMES_TO_BATTLEPLAN[key];
}

export function mapBattleplanStatusToHermes(status: BattleplanTaskStatus): HermesRunStatus {
  switch (status) {
    case 'DOING':
      return 'running';
    case 'REVIEW':
      return 'review';
    case 'BLOCKED':
      return 'blocked';
    case 'DONE':
      return 'done';
    case 'ABANDONED':
      return 'archived';
    default:
      return 'todo';
  }
}

export interface BackendHandoff {
  summary?: string;
  metadata?: Record<string, unknown>;
  branch?: string;
  head_sha?: string;
  artifacts?: string[];
}

export interface BackendRunObservation {
  connector_id: string;
  external_task_id: string;
  idempotency_key: string;
  status: BattleplanTaskStatus;
  handoff?: BackendHandoff;
}
