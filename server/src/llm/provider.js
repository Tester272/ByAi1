// server/src/llm/provider.js
// Provider-agnostic LLM client. Every provider is BYOK (bring-your-own-key).
import { openaiCompatible } from './openai.js';
import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { LLMError } from './errors.js';
export { LLMError };

//
// Internal message format used across the app:
//   { role: 'system'|'user'|'assistant'|'tool', content: string,
//     toolCalls?: [{ id, name, args }], toolCallId?: string, name?: string }
//
// Tools are described in OpenAI "function" JSON-schema form:
//   { type: 'function', function: { name, description, parameters } }
//
// Every adapter returns: { content, toolCalls, usage }

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-1.5-flash',
  'openai-compatible': 'gpt-4o-mini',
};

export const PROVIDERS = Object.keys(DEFAULT_MODELS);

export function defaultModel(provider) {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
}

export function createLLM({
  provider = 'openai',
  apiKey,
  model,
  baseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new LLMError('Missing API key for provider ' + provider, { provider });
  const name = String(provider).toLowerCase();
  const mdl = model || defaultModel(name);
  const opts = { apiKey, model: mdl, baseUrl, fetchImpl };

  switch (name) {
    case 'openai':
      return openaiCompatible({ ...opts, baseUrl: baseUrl || 'https://api.openai.com/v1', provider: 'openai' });
    case 'openai-compatible':
      return openaiCompatible({ ...opts, baseUrl: baseUrl || 'https://api.openai.com/v1', provider: 'openai-compatible' });
    case 'anthropic':
      return anthropic(opts);
    case 'gemini':
    case 'google':
      return gemini(opts);
    default:
      throw new LLMError(`Unknown provider "${provider}". Use one of: ${PROVIDERS.join(', ')}`, {
        provider: name,
      });
  }
}
