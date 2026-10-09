import { Injectable, inject } from '@angular/core';
import {
  runAgentConnectionTest,
  type AgentConnectionInput,
  type AgentConnectionResult,
} from '../core/agent-connection';
import { LOCAL_LLM_BROWSER_LIMITATION } from '../core/local-llm';
import type { AgentType } from '../core/models';
import { CursorKey } from './cursor-key.service';
import { electronBridge, isElectronApp } from './electron-bridge';

@Injectable({ providedIn: 'root' })
export class AgentConnectionService {
  private readonly cursorKey = inject(CursorKey);
  readonly isDesktop = isElectronApp();

  requiresDesktopApp(type: AgentType): boolean {
    return type === 'LocalLLM';
  }

  browserLimitationMessage(type: AgentType): string | null {
    if (type === 'LocalLLM' && !this.isDesktop) return LOCAL_LLM_BROWSER_LIMITATION;
    return null;
  }

  async testConnection(input: AgentConnectionInput): Promise<AgentConnectionResult> {
    const limitation = this.browserLimitationMessage(input.type);
    if (limitation) {
      return {
        ok: false,
        message: limitation,
        testedAt: new Date().toISOString(),
      };
    }

    const apiKey = input.apiKey.trim()
      || (input.type === 'Cursor Agent' ? this.cursorKey.value().trim() : '');
    const payload: AgentConnectionInput = { ...input, apiKey };
    const bridge = electronBridge();
    if (bridge) {
      return bridge.invoke<AgentConnectionResult>('agent:testConnection', payload);
    }
    return runAgentConnectionTest(payload);
  }
}
