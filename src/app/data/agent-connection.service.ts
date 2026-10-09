import { Injectable } from '@angular/core';
import type { AgentConnectionParams, AgentConnectionResult } from '../core/agent-connection';
import { LOCAL_LLM_BROWSER_LIMITATION } from '../core/local-llm';
import type { AgentType } from '../core/models';
import { electronBridge, isElectronApp } from './electron-bridge';

@Injectable({ providedIn: 'root' })
export class AgentConnectionService {
  readonly isDesktop = isElectronApp();

  requiresDesktopApp(type: AgentType): boolean {
    return type === 'LocalLLM';
  }

  browserLimitationMessage(type: AgentType): string | null {
    if (type === 'LocalLLM' && !this.isDesktop) return LOCAL_LLM_BROWSER_LIMITATION;
    return null;
  }

  async testConnection(params: AgentConnectionParams): Promise<AgentConnectionResult> {
    const limitation = this.browserLimitationMessage(params.type);
    if (limitation) {
      return {
        ok: false,
        message: limitation,
        testedAt: new Date().toISOString(),
      };
    }
    const bridge = electronBridge();
    if (bridge) {
      return bridge.invoke<AgentConnectionResult>('agent:testConnection', params);
    }
    return bridgeInvokeViaFetch(params);
  }
}

/** Browser fallback for cloud providers (LocalLLM blocked above). */
async function bridgeInvokeViaFetch(params: AgentConnectionParams): Promise<AgentConnectionResult> {
  const { runAgentConnectionTest } = await import('../core/agent-connection');
  const fetchFn: import('../core/agent-connection').AgentHttpFetch = async (url, init) => {
    try {
      const response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      return { status: response.status, bodyText: await response.text() };
    } catch (error) {
      return {
        status: 0,
        bodyText: error instanceof Error ? error.message : 'Network error.',
      };
    }
  };
  return runAgentConnectionTest(params, fetchFn);
}
