import { Component, Input, computed, signal } from '@angular/core';
import type { ProjectAgent } from '../../core/models';
import { agentStatisticsSnapshot, statisticsLabelForType } from '../../core/agent-statistics';

@Component({
  selector: 'app-agent-stats',
  standalone: true,
  templateUrl: './agent-stats.component.html',
  styleUrl: './agent-stats.component.scss',
})
export class AgentStatsComponent {
  private readonly agentSignal = signal<ProjectAgent | null>(null);

  @Input({ required: true }) set agent(value: ProjectAgent | null) {
    this.agentSignal.set(value);
  }

  readonly snapshot = computed(() => {
    const agent = this.agentSignal();
    return agent ? agentStatisticsSnapshot(agent) : null;
  });

  readonly typeNote = computed(() => {
    const agent = this.agentSignal();
    return agent ? statisticsLabelForType(agent.type) : '';
  });

  formatMetric(value: number | null, suffix = ''): string {
    if (value === null) return '—';
    return `${value.toLocaleString()}${suffix}`;
  }

  formatCost(value: number | null): string {
    if (value === null) return '—';
    return `$${value.toFixed(2)}`;
  }
}
