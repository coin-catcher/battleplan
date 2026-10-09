import type { ChatMessage, ProjectAgent } from '../core/models';
import { optionString } from '../core/agent-bindings';

export interface ResearchChatUsage {
  totalTokens?: number;
}

export interface ResearchChatResult {
  assistantText: string;
  usage: ResearchChatUsage;
}

export interface ResearchChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

function extractOpenAiUsage(payload: Record<string, unknown>): ResearchChatUsage {
  const usage = payload['usage'];
  if (!usage || typeof usage !== 'object') return {};
  const record = usage as Record<string, unknown>;
  const total = typeof record['total_tokens'] === 'number' ? record['total_tokens'] : undefined;
  return { totalTokens: total };
}

function extractOpenAiAssistant(payload: Record<string, unknown>): string {
  const choices = payload['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0];
  if (!first || typeof first !== 'object') return '';
  const message = (first as Record<string, unknown>)['message'];
  if (!message || typeof message !== 'object') return '';
  const content = (message as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content.trim() : '';
}

async function postJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; payload: Record<string, unknown>; text: string }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the research agent API.');
  }
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { message: text };
    }
  }
  return { ok: response.ok, status: response.status, payload, text };
}

function openAiCompatibleBase(url: string): string {
  return url.replace(/\/$/, '');
}

async function sendOpenAiCompatible(
  agent: ProjectAgent,
  turns: ResearchChatTurn[],
  systemPrompt: string,
): Promise<ResearchChatResult> {
  const apiKey = agent.api_key?.trim();
  if (!apiKey) throw new Error('Save an API key on this research agent before chatting.');
  const model = optionString(agent.options, 'model') || 'gpt-4.1-mini';
  const temperature = Number(optionString(agent.options, 'temperature') || '0.7');
  const maxTokensRaw = optionString(agent.options, 'max_output_tokens') || optionString(agent.options, 'max_tokens');
  const maxTokens = maxTokensRaw ? Number(maxTokensRaw) : undefined;
  const base = openAiCompatibleBase(agent.url);
  const path = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const messages: { role: string; content: string }[] = [];
  if (systemPrompt.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
  for (const turn of turns) messages.push({ role: turn.role, content: turn.content });

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: Number.isFinite(temperature) ? temperature : 0.7,
  };
  if (maxTokens !== undefined && Number.isFinite(maxTokens)) body['max_tokens'] = maxTokens;

  const { ok, payload, text } = await postJson(path, {
    method: 'POST',
    headers: bearerHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!ok) {
    const message = typeof payload['error'] === 'object'
      ? String((payload['error'] as Record<string, unknown>)['message'] ?? text)
      : String(payload['message'] ?? (text || 'Research agent request failed.'));
    throw new Error(message);
  }
  const assistantText = extractOpenAiAssistant(payload);
  if (!assistantText) throw new Error('Research agent returned an empty response.');
  return { assistantText, usage: extractOpenAiUsage(payload) };
}

async function sendAnthropic(
  agent: ProjectAgent,
  turns: ResearchChatTurn[],
  systemPrompt: string,
): Promise<ResearchChatResult> {
  const apiKey = agent.api_key?.trim();
  if (!apiKey) throw new Error('Save an API key on this research agent before chatting.');
  const model = optionString(agent.options, 'model') || 'claude-sonnet-4-20250514';
  const maxTokens = Number(optionString(agent.options, 'max_tokens') || '4096');
  const base = agent.url.replace(/\/$/, '');
  const path = `${base}/v1/messages`;
  const { ok, payload, text } = await postJson(path, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: Number.isFinite(maxTokens) ? maxTokens : 4096,
      system: systemPrompt.trim() || undefined,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
    }),
  });
  if (!ok) {
      throw new Error(String(payload['error'] ?? payload['message'] ?? (text || 'Anthropic request failed.')));
  }
  const content = payload['content'];
  let assistantText = '';
  if (Array.isArray(content)) {
    assistantText = content
      .map((block) => (block && typeof block === 'object' ? String((block as Record<string, unknown>)['text'] ?? '') : ''))
      .join('')
      .trim();
  }
  if (!assistantText) throw new Error('Anthropic returned an empty response.');
  const usageRaw = payload['usage'];
  const usageRecord = usageRaw && typeof usageRaw === 'object' ? usageRaw as Record<string, unknown> : {};
  const inputTokens = typeof usageRecord['input_tokens'] === 'number' ? usageRecord['input_tokens'] : 0;
  const outputTokens = typeof usageRecord['output_tokens'] === 'number' ? usageRecord['output_tokens'] : 0;
  return { assistantText, usage: { totalTokens: inputTokens + outputTokens } };
}

async function sendGemini(
  agent: ProjectAgent,
  turns: ResearchChatTurn[],
  systemPrompt: string,
): Promise<ResearchChatResult> {
  const apiKey = agent.api_key?.trim();
  if (!apiKey) throw new Error('Save an API key on this research agent before chatting.');
  const model = optionString(agent.options, 'model') || 'gemini-2.0-flash';
  const base = agent.url.replace(/\/$/, '');
  const path = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = turns.map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }],
  }));
  const body: Record<string, unknown> = { contents };
  if (systemPrompt.trim()) body['systemInstruction'] = { parts: [{ text: systemPrompt.trim() }] };

  const { ok, payload, text } = await postJson(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!ok) {
      throw new Error(String(payload['error'] ?? (text || 'Gemini request failed.')));
  }
  const candidates = payload['candidates'];
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const parts = first && typeof first === 'object'
    ? (first as Record<string, unknown>)['content']
    : undefined;
  const partList = parts && typeof parts === 'object' ? (parts as Record<string, unknown>)['parts'] : undefined;
  const assistantText = Array.isArray(partList)
    ? partList.map((part) => (part && typeof part === 'object' ? String((part as Record<string, unknown>)['text'] ?? '') : '')).join('').trim()
    : '';
  if (!assistantText) throw new Error('Gemini returned an empty response.');
  const usage = payload['usageMetadata'];
  const usageRecord = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {};
  const total = typeof usageRecord['totalTokenCount'] === 'number' ? usageRecord['totalTokenCount'] : undefined;
  return { assistantText, usage: { totalTokens: total } };
}

export function researchTurnsFromMessages(messages: ChatMessage[]): ResearchChatTurn[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));
}

export async function sendResearchAgentChat(
  agent: ProjectAgent,
  turns: ResearchChatTurn[],
  systemPrompt: string,
): Promise<ResearchChatResult> {
  switch (agent.type) {
    case 'OpenAI':
    case 'Grok':
    case 'LocalLLM':
      return sendOpenAiCompatible(agent, turns, systemPrompt);
    case 'Anthropic':
      return sendAnthropic(agent, turns, systemPrompt);
    case 'Gemini':
      return sendGemini(agent, turns, systemPrompt);
    default:
      throw new Error(`Research chat is not supported for agent type ${agent.type}.`);
  }
}
