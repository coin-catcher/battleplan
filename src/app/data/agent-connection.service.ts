import { Injectable, inject } from '@angular/core';
import {
  runAgentConnectionTest,
  type AgentConnectionInput,
  type AgentConnectionResult,
} from '../core/agent-connection';
import { CursorKey } from './cursor-key.service';
import { electronBridge } from './electron-bridge';

@Injectable({ providedIn: 'root' })
export class AgentConnectionService {
  private readonly cursorKey = inject(CursorKey);

  async testConnection(input: AgentConnectionInput): Promise<AgentConnectionResult> {
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
