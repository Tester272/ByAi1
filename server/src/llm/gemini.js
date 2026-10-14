// server/src/llm/gemini.js
// Google Gemini (generativelanguage) adapter.
import { LLMError, readError } from './errors.js';

function toGemini(messages) {
  const systemParts = [];
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.name || 'tool',
              response: { result: m.content ?? '' },
            },
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({ functionCall: { name: tc.name, args: tc.args ?? {} } });
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content ?? '' }],
    });
  }
  return { systemParts, contents };
}

export function gemini({ apiKey, model, baseUrl, fetchImpl }) {
  const base = (baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  return {
    provider: 'gemini',
    model,
    async chat({ messages, tools = [], signal, temperature = 0.3 }) {
      const { systemParts, contents } = toGemini(messages);
      const body = { contents, generationConfig: { temperature } };
      if (systemParts.length) body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
      if (tools.length) {
        body.tools = [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            })),
          },
        ];
      }
      const url = `${base}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new LLMError(`gemini request failed (${res.status})`, {
          status: res.status,
          provider: 'gemini',
          body: await readError(res),
        });
      }
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      let content = '';
      const toolCalls = [];
      for (const p of parts) {
        if (p.text) content += p.text;
        else if (p.functionCall) {
          toolCalls.push({
            id: `call_${toolCalls.length}_${Math.random().toString(36).slice(2, 8)}`,
            name: p.functionCall.name,
            args: p.functionCall.args || {},
          });
        }
      }
      return { content, toolCalls, usage: data.usageMetadata || null };
    },
  };
}
