import { Component, computed, input } from '@angular/core';
import type { ProjectAgent } from '../core/models';
import { agentStatisticsSnapshot, statisticsLabelForType } from '../core/agent-statistics';

@Component({
  selector: 'app-agent-stats',
  standalone: true,
  templateUrl: './agent-stats.component.html',
  styleUrl: './agent-stats.component.scss',
})
export class AgentStatsComponent {
  readonly agent = input<ProjectAgent | null>(null);

  readonly snapshot = computed(() => {
    const value = this.agent();
    return value ? agentStatisticsSnapshot(value) : null;
  });

  readonly typeNote = computed(() => {
    const value = this.agent();
    return value ? statisticsLabelForType(value.type) : '';
  });

  formatMetric(value: number | null): string {
    if (value === null) return '—';
    return value.toLocaleString();
  }

  formatCost(value: number | null): string {
    if (value === null) return '—';
    return `$${value.toFixed(2)}`;
  }
}
