import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import type { ProjectAgent } from '../../core/models';
import {
  formatStatisticValue,
  statisticsLabelForType,
  type AgentStatisticsSnapshot,
  type StatisticValue,
} from '../../core/agent-statistics';
import { AgentStatisticsService } from '../../data/agent-statistics.service';
import { BattleplanStore } from '../../state/battleplan-store.service';

@Component({
  selector: 'app-agent-stats',
  standalone: true,
  templateUrl: './agent-stats.component.html',
  styleUrl: './agent-stats.component.scss',
})
export class AgentStatsComponent {
  private readonly statsService = inject(AgentStatisticsService);
  private readonly store = inject(BattleplanStore);

  private readonly agentSignal = signal<ProjectAgent | null>(null);

  @Input({ required: true }) set agent(value: ProjectAgent | null) {
    this.agentSignal.set(value);
  }

  readonly snapshot = signal<AgentStatisticsSnapshot | null>(null);
  readonly loading = signal(false);

  readonly typeNote = computed(() => {
    const agent = this.agentSignal();
    return agent ? statisticsLabelForType(agent.type) : '';
  });

  constructor() {
    effect(() => {
      const agent = this.agentSignal();
      const projectId = this.store.projectId();
      if (!agent || !projectId || !agent.agent_id) {
        this.snapshot.set(null);
        return;
      }
      this.loading.set(true);
      void this.statsService
        .loadSnapshot(projectId, agent)
        .then((value) => this.snapshot.set(value))
        .finally(() => this.loading.set(false));
    });
  }

  formatMetric(value: StatisticValue, asCost = false): string {
    return formatStatisticValue(
      value,
      (n) => n.toLocaleString(),
      asCost ? (n) => `$${n.toFixed(2)}` : undefined,
    );
  }

  barHeight(value: number, max: number): string {
    if (max <= 0) return '4px';
    const ratio = Math.min(1, value / max);
    return `${Math.max(4, Math.round(ratio * 100))}%`;
  }

  chartMax(stats: AgentStatisticsSnapshot): number {
    return Math.max(stats.chart.tokensToday, stats.chart.tokensPeriod, 1);
  }

  costMax(stats: AgentStatisticsSnapshot): number {
    return Math.max(stats.chart.costTodayUsd, stats.chart.costPeriodUsd, 0.01);
  }

  remainingMeterWidth(amount: number | null): number {
    if (amount === null || amount <= 0) return 0;
    return Math.min(100, amount);
  }
}
