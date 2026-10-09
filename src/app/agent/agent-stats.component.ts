import { Component, input } from '@angular/core';

@Component({
  selector: 'app-agent-stats',
  standalone: true,
  template: `
    <footer class="agent-stats">
      <p class="eyebrow">Statistics</p>
      <p class="agent-stats-placeholder">Usage dashboard for agent {{ agentId() ?? '…' }} — coming soon.</p>
    </footer>
  `,
  styles: [`
    .agent-stats {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .agent-stats-placeholder {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
  `],
})
export class AgentStatsComponent {
  readonly agentId = input<string | null>(null);
}
