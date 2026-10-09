import { Injectable } from '@angular/core';
import { runAgentConnectionTest, type AgentConnectionInput, type AgentConnectionResult } from '../core/agent-connection';
import { electronBridge } from './electron-bridge';

@Injectable({ providedIn: 'root' })
export class AgentConnectionService {
  async testConnection(input: AgentConnectionInput): Promise<AgentConnectionResult> {
    const bridge = electronBridge();
    if (bridge) {
      return bridge.invoke<AgentConnectionResult>('agent:testConnection', input);
    }
    return runAgentConnectionTest(input);
  }
}
