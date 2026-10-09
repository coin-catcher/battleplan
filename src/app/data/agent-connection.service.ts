import { Injectable, inject } from '@angular/core';
import { testProjectAgentConnection, type AgentConnectionTestResult } from '../core/agent-connection';
import type { ProjectAgent } from '../core/models';
import { CursorKey } from './cursor-key.service';
import { electronBridge } from './electron-bridge';

@Injectable({ providedIn: 'root' })
export class AgentConnectionService {
  private readonly cursorKey = inject(CursorKey);

  async testConnection(agent: ProjectAgent): Promise<AgentConnectionTestResult> {
    const globalKey = this.cursorKey.value();
    const bridge = electronBridge();
    if (bridge) {
      return bridge.invoke<AgentConnectionTestResult>('agent:testConnection', agent, globalKey);
    }
    return testProjectAgentConnection(agent, globalKey, (url, init) => fetch(url, init));
  }
}
