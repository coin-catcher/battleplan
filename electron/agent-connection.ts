import type { AgentConnectionInput, AgentConnectionResult } from '../src/app/core/agent-connection';
import { runAgentConnectionTest } from '../src/app/core/agent-connection';

const REQUEST_TIMEOUT_MS = 30_000;

export async function runAgentConnectionInMain(input: AgentConnectionInput): Promise<AgentConnectionResult> {
  return runAgentConnectionTest(input, async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  });
}
