import { Injectable, inject } from '@angular/core';
import { BattleplanApi } from '../api/battleplan-api.service';
import {
  buildAgentStatisticsSnapshot,
  type AgentStatisticsLiveData,
  type AgentStatisticsSnapshot,
} from '../core/agent-statistics';
import { getAgentTypeDefinition } from '../core/agent-types';
import type { ProjectAgent } from '../core/models';
import { electronBridge } from './electron-bridge';

interface CacheEntry {
  fetchedAtMs: number;
  live: AgentStatisticsLiveData;
}

@Injectable({ providedIn: 'root' })
export class AgentStatisticsService {
  private readonly api = inject(BattleplanApi);
  private readonly cache = new Map<string, CacheEntry>();

  async loadSnapshot(projectId: string, agent: ProjectAgent): Promise<AgentStatisticsSnapshot> {
    const ledger = await this.api.getAgentUsageLedger(projectId);
    const ledgerEntry = ledger[agent.agent_id];
    const live = await this.resolveLiveData(agent);
    return buildAgentStatisticsSnapshot(agent, ledgerEntry, live, new Date().toISOString());
  }

  private cacheKey(agent: ProjectAgent): string {
    return `${agent.agent_id}:${agent.type}:${agent.updated_at}`;
  }

  private pollIntervalMs(agent: ProjectAgent): number {
    const minutes = getAgentTypeDefinition(agent.type).statistics.pollIntervalMinutes ?? 0;
    return minutes > 0 ? minutes * 60_000 : 0;
  }

  private shouldUseCache(agent: ProjectAgent): boolean {
    const interval = this.pollIntervalMs(agent);
    if (interval <= 0) return false;
    const entry = this.cache.get(this.cacheKey(agent));
    if (!entry) return false;
    return Date.now() - entry.fetchedAtMs < interval;
  }

  private async resolveLiveData(agent: ProjectAgent): Promise<AgentStatisticsLiveData | null> {
    if (this.shouldUseCache(agent)) {
      return this.cache.get(this.cacheKey(agent))?.live ?? null;
    }

    const bridge = electronBridge();
    const needsAdmin = agent.type === 'OpenAI' || agent.type === 'Anthropic' || agent.type === 'Cursor Agent';
    const needsMetrics = agent.type === 'LocalLLM';
    if (!bridge && (needsAdmin || needsMetrics)) {
      return null;
    }
    if (needsAdmin && !agent.admin_api_key?.trim()) {
      return null;
    }

    if (!bridge) return null;

    const live = await bridge.invoke<AgentStatisticsLiveData>('agent:fetchStatistics', {
      type: agent.type,
      url: agent.url,
      adminApiKey: agent.admin_api_key,
      apiKey: agent.api_key,
      cursorAgentId: agent.cursor_agent_id,
    });

    if (this.pollIntervalMs(agent) > 0 && !live.error) {
      this.cache.set(this.cacheKey(agent), { fetchedAtMs: Date.now(), live });
    }

    return live;
  }
}
