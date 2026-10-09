import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AgentOptionValue, AgentType, ProjectAgent } from '../../core/models';
import { agentEditorDirty } from '../../core/editor-dirty';
import {
  agentFormFromSaved,
  applyAgentTypeChange,
  isAgentDraftId,
  projectAgentFromForm,
  type AgentEditorForm,
} from '../../core/agent-form';
import {
  agentLogoPublicPath,
  agentOptionRows,
  agentTypesForKind,
  getAgentTypeDefinition,
  isAgentOptionVisible,
  type AgentOptionDefinition,
} from '../../core/agent-types';
import { applyDynamicModelsToOptions, selectChoicesForOption } from '../../core/agent-connection';
import { AgentConnectionService } from '../../data/agent-connection.service';
import { BattleplanStore } from '../../state/battleplan-store.service';
import { AgentStatsComponent } from '../agent-stats/agent-stats.component';

@Component({
  selector: 'app-agent-editor',
  standalone: true,
  imports: [FormsModule, AgentStatsComponent],
  templateUrl: './agent-editor.component.html',
  styleUrl: './agent-editor.component.scss',
})
export class AgentEditorComponent {
  readonly store = inject(BattleplanStore);
  private readonly connections = inject(AgentConnectionService);

  readonly agentInput = signal<ProjectAgent | null>(null);
  readonly createMode = signal(false);
  readonly form = signal<AgentEditorForm | null>(null);
  readonly apiKeyFocused = signal(false);
  readonly adminApiKeyFocused = signal(false);
  readonly testState = signal<'idle' | 'success' | 'error'>('idle');
  readonly testMessage = signal('');
  readonly dynamicModelChoices = signal<string[]>([]);
  private testFadeTimer: ReturnType<typeof setTimeout> | undefined;

  @Input({ required: true }) set agent(value: ProjectAgent | null) {
    this.agentInput.set(value);
  }

  @Input() set mode(value: 'create' | 'edit') {
    this.createMode.set(value === 'create');
  }

  readonly headerLogo = computed(() => {
    const form = this.form();
    return form ? agentLogoPublicPath(form.type) : '';
  });

  readonly typeChoices = computed((): AgentType[] => {
    const agent = this.agentInput();
    if (!agent) return [];
    return agentTypesForKind(agent.kind);
  });

  readonly visibleOptions = computed((): AgentOptionDefinition[] => {
    const form = this.form();
    if (!form) return [];
    return agentOptionRows(form.type).filter((row) => isAgentOptionVisible(row, form.options));
  });

  constructor() {
    effect(() => {
      const agent = this.agentInput();
      if (!agent) {
        this.form.set(null);
        return;
      }
      this.form.set(agentFormFromSaved(agent));
      this.dynamicModelChoices.set([]);
      this.apiKeyFocused.set(false);
      this.adminApiKeyFocused.set(false);
    });
  }

  selectChoices(row: AgentOptionDefinition): string[] {
    const form = this.form();
    if (!form) return row.choices ? [...row.choices] : [];
    return selectChoicesForOption(form.type, row.key, row.choices, this.dynamicModelChoices());
  }

  localLlmBrowserNotice(): string | null {
    const form = this.form();
    if (!form) return null;
    return this.connections.browserLimitationMessage(form.type);
  }

  agentLogo(type: AgentType): string {
    return agentLogoPublicPath(type);
  }

  onTypeChange(nextType: AgentType): void {
    const form = this.form();
    if (!form || form.type === nextType) return;
    applyAgentTypeChange(form, nextType);
    this.dynamicModelChoices.set([]);
    this.form.set({ ...form, options: { ...form.options } });
    this.syncDraft();
  }

  onNameInput(value: string): void {
    const form = this.form();
    if (!form) return;
    form.name = value;
    form.nameTouched = true;
    this.form.set({ ...form });
    this.syncDraft();
  }

  onUrlInput(value: string): void {
    const form = this.form();
    if (!form) return;
    form.url = value;
    form.urlTouched = true;
    this.form.set({ ...form });
    this.syncDraft();
  }

  onApiKeyInput(value: string): void {
    const form = this.form();
    if (!form) return;
    form.api_key = value;
    form.apiKeyTouched = true;
    this.form.set({ ...form });
  }

  onAdminApiKeyInput(value: string): void {
    const form = this.form();
    if (!form) return;
    form.admin_api_key = value;
    form.adminApiKeyTouched = true;
    this.form.set({ ...form });
  }

  onOptionChange(key: string, value: AgentOptionValue): void {
    const form = this.form();
    if (!form) return;
    form.options = { ...form.options, [key]: value };
    this.form.set({ ...form, options: { ...form.options } });
    this.syncDraft();
  }

  apiKeyDisplay(agent: ProjectAgent | null, form: AgentEditorForm): string {
    if (!agent?.api_key || form.apiKeyTouched || this.apiKeyFocused()) return form.api_key;
    return '********';
  }

  adminApiKeyDisplay(agent: ProjectAgent | null, form: AgentEditorForm): string {
    if (!agent?.admin_api_key || form.adminApiKeyTouched || this.adminApiKeyFocused()) return form.admin_api_key;
    return '********';
  }

  showSave(agent: ProjectAgent | null): boolean {
    return Boolean(agent && isAgentDraftId(agent.agent_id));
  }

  showDelete(agent: ProjectAgent | null): boolean {
    return Boolean(agent && !this.createMode() && !isAgentDraftId(agent.agent_id));
  }

  isDirty(): boolean {
    const agent = this.agentInput();
    const form = this.form();
    if (!agent || !form) return false;
    return agentEditorDirty(form, agent);
  }

  async save(): Promise<void> {
    const agent = this.agentInput();
    const form = this.form();
    if (!agent || !form) return;
    const saved = await this.store.saveAgentFromForm(form, agent);
    if (saved) this.agentInput.set(saved);
  }

  async deleteAgent(): Promise<void> {
    const agent = this.agentInput();
    if (!agent || isAgentDraftId(agent.agent_id)) return;
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    await this.store.deleteAgent(agent.agent_id);
  }

  cancelCreate(): void {
    const agent = this.agentInput();
    if (agent && isAgentDraftId(agent.agent_id)) {
      this.store.discardAgentDraft(agent.agent_id);
    }
  }

  async testConnection(): Promise<void> {
    const agent = this.agentInput();
    const form = this.form();
    if (!agent || !form) return;
    const apiKey = form.apiKeyTouched ? form.api_key.trim() : (agent.api_key ?? form.api_key).trim();
    const result = await this.connections.testConnection({
      type: form.type,
      url: form.url.trim() || getAgentTypeDefinition(form.type).defaultUrl,
      apiKey,
    });
    if (this.testFadeTimer) clearTimeout(this.testFadeTimer);
    if (result.ok) {
      this.testState.set('success');
      this.testMessage.set(result.message);
      if (result.models?.length) {
        this.dynamicModelChoices.set(result.models);
        form.options = applyDynamicModelsToOptions(form.type, form.options, result.models);
        this.form.set({ ...form, options: { ...form.options } });
        this.syncDraft();
      }
      this.testFadeTimer = setTimeout(() => {
        this.testState.set('idle');
        this.testMessage.set('');
      }, 5000);
    } else {
      this.testState.set('error');
      this.testMessage.set(result.message);
    }
    if (!isAgentDraftId(agent.agent_id)) {
      const updated: ProjectAgent = {
        ...projectAgentFromForm(form, agent),
        last_test_at: new Date().toISOString(),
        last_test_status: result.ok ? 'success' : 'error',
        last_test_message: result.message,
      };
      await this.store.persistAgentRecord(updated);
      this.agentInput.set(updated);
    }
  }

  private syncDraft(): void {
    const agent = this.agentInput();
    const form = this.form();
    if (!agent || !form || !isAgentDraftId(agent.agent_id)) return;
    const draft = projectAgentFromForm(form, agent);
    this.store.updateAgentDraft(agent.agent_id, draft);
    this.agentInput.set(draft);
  }
}
