import { getAgentTypeDefinition } from './agent-types';
import type { ProjectAgent } from './models';

export interface AgentStatisticsDataSource {
  adapter: string;
  label: string;
  requiresEnterpriseAdminKey?: boolean;
  pollIntervalMinutes?: number;
}

/** Describes how usage metrics are sourced for the agent editor dashboard. */
export function agentStatisticsDataSource(agent: ProjectAgent): AgentStatisticsDataSource {
  const recipe = getAgentTypeDefinition(agent.type).statistics;
  if (recipe.adapter === 'cursor_admin_api') {
    return {
      adapter: recipe.adapter,
      label: agent.cursor_agent_id
        ? 'Enterprise Admin API when configured; otherwise BattlePlan runs for this cursor_agent_id.'
        : 'Enterprise Admin API when configured; otherwise local run ledger after first cloud agent launch.',
      requiresEnterpriseAdminKey: recipe.requiresEnterpriseAdminKey,
      pollIntervalMinutes: recipe.pollIntervalMinutes,
    };
  }
  return {
    adapter: recipe.adapter,
    label: recipe.adapter.replace(/_/g, ' '),
    requiresEnterpriseAdminKey: recipe.requiresEnterpriseAdminKey,
    pollIntervalMinutes: recipe.pollIntervalMinutes,
  };
}
