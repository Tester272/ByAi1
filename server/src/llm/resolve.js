// server/src/llm/resolve.js
// Single source of truth for "which LLM should this request use".
// Priority: explicit request > per-task config > saved settings > server env.
import { createLLM, defaultModel } from './provider.js';

export function createLLMResolver({ store, config, fetchImpl = globalThis.fetch }) {
  return function resolveLLM(body = {}, taskLlm = null) {
    const saved = store.getSetting('llm', {}) || {};
    const t = taskLlm || {};
    const provider =
      body.provider || t.provider || saved.provider || config.defaultLlm.provider || 'openai';
    const apiKey = body.apiKey || t.apiKey || saved.apiKey || config.defaultLlm.apiKey;
    const model =
      body.model || t.model || saved.model || config.defaultLlm.model || defaultModel(provider);
    const baseUrl =
      body.baseUrl || t.baseUrl || saved.baseUrl || config.defaultLlm.baseUrl || undefined;
    return createLLM({ provider, apiKey, model, baseUrl, fetchImpl });
  };
}
