import type { AgentKind, AgentOptionValue, AgentType } from './models';
import { AGENT_TYPES } from './models';

export type AgentOptionControl = 'text' | 'textarea' | 'number' | 'checkbox' | 'select';

export interface AgentOptionDefinition {
  key: string;
  label: string;
  control: AgentOptionControl;
  default?: AgentOptionValue;
  choices?: readonly string[];
  min?: number;
  max?: number;
  help?: string;
  /** When set, option row is hidden unless every key matches `options`. */
  visibleWhen?: Record<string, AgentOptionValue>;
  dynamic?: boolean;
  mapsToApi?: string;
  inheritFrom?: string;
}

export interface AgentTestConnectionRecipe {
  method: 'GET' | 'POST';
  path: string;
  auth: 'bearer' | 'x-api-key' | 'query_key' | 'basic' | 'none';
  successHttp?: number[];
  userErrorMap?: Record<number, string>;
  headers?: Record<string, string>;
  body?: unknown;
  queryParam?: string;
  basicPasswordEmpty?: boolean;
  fallbackPath?: string;
  fallbackMethod?: 'GET' | 'POST';
  fallbackBody?: unknown;
  altPath?: string;
  note?: string;
}

export interface AgentStatisticsRecipe {
  adapter: string;
  requiresSeparateAdminKey?: boolean;
  requiresEnterpriseAdminKey?: boolean;
  adminKeyHint?: string;
  pollIntervalMinutes?: number;
  primary?: string;
  secondary?: string;
  priceHintUsdPerMtok?: { input: number; output: number; model: string };
  metricsPath?: string;
}

export interface AgentTypeDefinition {
  kind: AgentKind;
  defaultName: string;
  defaultUrl: string;
  logoAsset: string;
  logoAlt: string;
  testConnection: AgentTestConnectionRecipe;
  statistics: AgentStatisticsRecipe;
  specificOptions: readonly AgentOptionDefinition[];
}

/** Shared options prepended to every agent type (see agent-types.yaml). */
export const AGENT_COMMON_OPTIONS: readonly AgentOptionDefinition[] = [
  {
    key: 'system_prompt',
    label: 'System Prompt',
    control: 'textarea',
    default: '',
    help: 'Persistent system instructions for this agent.',
  },
  {
    key: 'use_reasoning',
    label: 'Use Reasoning',
    control: 'checkbox',
    default: false,
    help: 'Enable provider-specific reasoning/thinking when supported.',
  },
  {
    key: 'use_tool_calls',
    label: 'Use Tool Calls',
    control: 'checkbox',
    default: false,
    help: 'Allow models to invoke tools/functions when supported.',
  },
];

export const AGENT_TYPE_REGISTRY: Record<AgentType, AgentTypeDefinition> = {
  OpenAI: {
    kind: 'research',
    defaultName: 'OpenAI Research',
    defaultUrl: 'https://api.openai.com/v1',
    logoAsset: 'openai.svg',
    logoAlt: 'OpenAI',
    testConnection: {
      method: 'GET',
      path: '/models',
      auth: 'bearer',
      successHttp: [200],
      userErrorMap: {
        401: 'Invalid API key or unauthorized for this organization.',
        403: 'API key lacks permission to list models.',
      },
    },
    statistics: {
      adapter: 'openai_org_admin',
      requiresSeparateAdminKey: true,
      adminKeyHint: 'Organization Admin API key (not the same as project sk- key).',
    },
    specificOptions: [
      { key: 'model', label: 'Model', control: 'select', default: 'gpt-4.1-mini', choices: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'] },
      {
        key: 'reasoning_effort',
        label: 'Reasoning effort',
        control: 'select',
        default: 'medium',
        choices: ['low', 'medium', 'high'],
        visibleWhen: { use_reasoning: true },
        mapsToApi: 'reasoning.effort on Responses API / o-series models',
      },
      { key: 'temperature', label: 'Temperature', control: 'number', default: 0.7, min: 0, max: 2 },
      { key: 'max_output_tokens', label: 'Max output tokens', control: 'number', default: 4096 },
      { key: 'parallel_tool_calls', label: 'Parallel tool calls', control: 'checkbox', default: true, visibleWhen: { use_tool_calls: true } },
      {
        key: 'tool_choice',
        label: 'Tool choice',
        control: 'select',
        default: 'auto',
        choices: ['auto', 'none', 'required'],
        visibleWhen: { use_tool_calls: true },
      },
      { key: 'store', label: 'Store conversation (OpenAI)', control: 'checkbox', default: false, help: 'When true, uses stored responses features where enabled for the account.' },
    ],
  },
  Anthropic: {
    kind: 'research',
    defaultName: 'Anthropic Research',
    defaultUrl: 'https://api.anthropic.com',
    logoAsset: 'anthropic.svg',
    logoAlt: 'Anthropic',
    testConnection: {
      method: 'POST',
      path: '/v1/messages',
      auth: 'x-api-key',
      headers: { 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-sonnet-4-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
      successHttp: [200],
      userErrorMap: { 401: 'Invalid Anthropic API key.', 403: 'Key valid but model access denied.' },
    },
    statistics: { adapter: 'anthropic_admin', requiresSeparateAdminKey: true },
    specificOptions: [
      {
        key: 'model',
        label: 'Model',
        control: 'select',
        default: 'claude-sonnet-4-20250514',
        choices: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
      },
      { key: 'max_tokens', label: 'Max tokens', control: 'number', default: 8192 },
      { key: 'thinking_budget_tokens', label: 'Thinking budget (tokens)', control: 'number', default: 10000, visibleWhen: { use_reasoning: true }, mapsToApi: 'thinking.type enabled with budget_tokens' },
      { key: 'thinking_type', label: 'Thinking mode', control: 'select', default: 'enabled', choices: ['enabled', 'disabled'], visibleWhen: { use_reasoning: true } },
      { key: 'tool_choice', label: 'Tool choice', control: 'select', default: 'auto', choices: ['auto', 'any', 'none'], visibleWhen: { use_tool_calls: true } },
      { key: 'disable_parallel_tool_use', label: 'Disable parallel tool use', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
      { key: 'server_tools_web_search', label: 'Anthropic web search tool', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
      { key: 'server_tools_code_execution', label: 'Anthropic code execution tool', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
    ],
  },
  Gemini: {
    kind: 'research',
    defaultName: 'Gemini Research',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
    logoAsset: 'googlegemini.svg',
    logoAlt: 'Google Gemini',
    testConnection: { method: 'GET', path: '/models', auth: 'query_key', queryParam: 'key', successHttp: [200] },
    statistics: { adapter: 'gemini_hybrid', primary: 'local_ledger_from_usage_metadata', secondary: 'cloud_billing_export_optional' },
    specificOptions: [
      { key: 'model', label: 'Model', control: 'select', default: 'gemini-2.5-flash', choices: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
      { key: 'thinking_budget', label: 'Thinking budget', control: 'select', default: 'auto', choices: ['auto', 'off', 'low', 'medium', 'high'], visibleWhen: { use_reasoning: true }, mapsToApi: 'thinkingConfig / thinkingBudget per model docs' },
      { key: 'temperature', label: 'Temperature', control: 'number', default: 1.0, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', control: 'number', default: 0.95 },
      { key: 'function_calling_mode', label: 'Function calling mode', control: 'select', default: 'AUTO', choices: ['AUTO', 'ANY', 'NONE'], visibleWhen: { use_tool_calls: true } },
      { key: 'google_search_grounding', label: 'Google Search grounding', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
      { key: 'code_execution', label: 'Code execution tool', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
    ],
  },
  Grok: {
    kind: 'research',
    defaultName: 'Grok Research',
    defaultUrl: 'https://api.x.ai/v1',
    logoAsset: 'xai.svg',
    logoAlt: 'xAI Grok',
    testConnection: {
      method: 'GET',
      path: '/models',
      auth: 'bearer',
      successHttp: [200],
      userErrorMap: {
        401: 'Invalid xAI API key.',
        403: 'API key cannot list models; connection may still work via Responses API.',
      },
      fallbackMethod: 'POST',
      fallbackPath: '/responses',
      fallbackBody: {
        model: 'grok-4-1-fast-non-reasoning',
        input: [{ role: 'user', content: 'ping' }],
        max_output_tokens: 1,
        store: false,
      },
      note: 'Grok research uses POST /v1/responses; fall back when GET /models is unavailable for the key tier.',
    },
    statistics: { adapter: 'local_ledger', priceHintUsdPerMtok: { input: 2.0, output: 6.0, model: 'grok-4.7' } },
    specificOptions: [
      { key: 'model', label: 'Model', control: 'select', default: 'grok-4.7', choices: ['grok-4.7', 'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning'] },
      { key: 'reasoning_effort', label: 'Reasoning effort', control: 'select', default: 'high', choices: ['low', 'medium', 'high', 'xhigh'], visibleWhen: { use_reasoning: true }, mapsToApi: 'reasoning.effort on POST /v1/responses' },
      { key: 'prompt_cache_key', label: 'Prompt cache key', control: 'text', default: '', help: 'Improves multi-turn cache hits on Responses API.' },
      { key: 'builtin_web_search', label: 'Web search tool', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
      { key: 'builtin_x_search', label: 'X search tool', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
      { key: 'builtin_code_interpreter', label: 'Code interpreter tool', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true } },
      { key: 'custom_functions_json', label: 'Custom function schemas (JSON array)', control: 'textarea', default: '[]', visibleWhen: { use_tool_calls: true } },
    ],
  },
  'Cursor Agent': {
    kind: 'code',
    defaultName: 'Cursor Code Agent',
    defaultUrl: 'https://api.cursor.com/v1',
    logoAsset: 'cursor.svg',
    logoAlt: 'Cursor',
    testConnection: {
      method: 'GET',
      path: '/v1/me',
      auth: 'basic',
      basicPasswordEmpty: true,
      successHttp: [200],
      fallbackPath: '/v1/agents',
      note: 'Match CursorKey auth used in cursor-browser.ts (API key as Basic username).',
    },
    statistics: { adapter: 'cursor_admin_api', requiresEnterpriseAdminKey: true, pollIntervalMinutes: 60 },
    specificOptions: [
      { key: 'default_mode', label: 'Default run mode', control: 'select', default: 'agent', choices: ['agent', 'plan'] },
      { key: 'default_repo_url', label: 'Default repository URL', control: 'text', default: '', inheritFrom: 'project.repo_url' },
      { key: 'default_starting_ref', label: 'Default starting ref', control: 'text', default: 'develop', inheritFrom: 'project.starting_ref' },
      { key: 'auto_create_pr', label: 'Auto-create PR (platform)', control: 'checkbox', default: false, help: 'Battleplan policy disables PR creation in agents; keep false unless product changes.' },
      { key: 'model', label: 'Model preference', control: 'text', default: '', help: 'Optional; when Cursor exposes explicit model pickers document mapping here.' },
      { key: 'env_vars_json', label: 'Environment variables (JSON object)', control: 'textarea', default: '{}' },
    ],
  },
  LocalLLM: {
    kind: 'research',
    defaultName: 'Local vLLM',
    defaultUrl: 'http://127.0.0.1:8000/v1',
    logoAsset: 'vllm.svg',
    logoAlt: 'Local vLLM',
    testConnection: { method: 'GET', path: '/health', auth: 'none', altPath: '/v1/models', successHttp: [200] },
    statistics: { adapter: 'vllm_metrics_plus_ledger', metricsPath: '/metrics' },
    specificOptions: [
      { key: 'model', label: 'Model', control: 'select', default: '', dynamic: true, help: 'Populated from GET /v1/models after a successful connection test.' },
      { key: 'temperature', label: 'Temperature', control: 'number', default: 0.7 },
      { key: 'max_tokens', label: 'Max tokens', control: 'number', default: 2048 },
      { key: 'top_p', label: 'Top P', control: 'number', default: 0.9 },
      { key: 'enable_auto_tool_choice', label: 'Enable tool use (OpenAI-compatible tools)', control: 'checkbox', default: false, visibleWhen: { use_tool_calls: true }, help: 'Requires vLLM served with tool-call parser for the model.' },
      { key: 'reasoning_parser', label: 'Reasoning parser', control: 'text', default: '', visibleWhen: { use_reasoning: true }, help: 'vLLM --reasoning-parser flag alignment for thinking models.' },
    ],
  },
};

export function listAgentTypes(): AgentType[] {
  return [...AGENT_TYPES];
}

export function agentTypesForKind(kind: AgentKind): AgentType[] {
  return listAgentTypes().filter((type) => AGENT_TYPE_REGISTRY[type].kind === kind);
}

export function getAgentTypeDefinition(type: AgentType): AgentTypeDefinition {
  return AGENT_TYPE_REGISTRY[type];
}

export function agentLogoPublicPath(type: AgentType): string {
  return `/assets/agents/${AGENT_TYPE_REGISTRY[type].logoAsset}`;
}

export function agentOptionRows(type: AgentType): readonly AgentOptionDefinition[] {
  return [...AGENT_COMMON_OPTIONS, ...AGENT_TYPE_REGISTRY[type].specificOptions];
}

export function defaultOptionValues(type: AgentType): Record<string, AgentOptionValue> {
  const values: Record<string, AgentOptionValue> = {};
  for (const option of agentOptionRows(type)) {
    if (option.default !== undefined) values[option.key] = option.default;
  }
  return values;
}

export function isAgentOptionVisible(option: AgentOptionDefinition, options: Record<string, AgentOptionValue>): boolean {
  if (!option.visibleWhen) return true;
  return Object.entries(option.visibleWhen).every(([key, expected]) => options[key] === expected);
}

/** Merge registry defaults with saved options; saved values win. */
export function mergeAgentOptions(type: AgentType, saved: Record<string, AgentOptionValue> | undefined): Record<string, AgentOptionValue> {
  return { ...defaultOptionValues(type), ...(saved ?? {}) };
}
