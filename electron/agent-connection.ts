import type { AgentConnectionParams, AgentConnectionResult, AgentHttpFetch } from '../src/app/core/agent-connection';
import { runAgentConnectionTest } from '../src/app/core/agent-connection';

const REQUEST_TIMEOUT_MS = 30_000;

export const agentHttpFetch: AgentHttpFetch = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return { status: response.status, bodyText };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 0, bodyText: 'Request timed out.' };
    }
    return { status: 0, bodyText: error instanceof Error ? error.message : 'Network error.' };
  } finally {
    clearTimeout(timer);
  }
};

export async function runAgentConnectionInMain(params: AgentConnectionParams): Promise<AgentConnectionResult> {
  return runAgentConnectionTest(params, agentHttpFetch);
}
