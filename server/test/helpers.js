// test/helpers.js
// Small helpers shared by the tests: a mock fetch and a scripted mock LLM.

export function mockResponse(body, { ok = true, status = 200, contentType = 'application/json' } = {}) {
  return {
    ok,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : '') },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

/** A fetch stub that answers based on URL matching. */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [pattern, handler] of routes) {
      if (String(url).includes(pattern)) {
        return typeof handler === 'function' ? handler(url, opts) : handler;
      }
    }
    throw new Error(`fakeFetch: no route for ${url}`);
  };
  fn.calls = calls;
  return fn;
}

/**
 * A scripted LLM that returns a queue of responses. Each entry is either
 * { content } or { toolCalls: [{ id, name, args }] }.
 */
export function scriptedLLM(script) {
  let i = 0;
  return {
    provider: 'mock',
    model: 'mock-1',
    calls: [],
    async chat({ messages, tools }) {
      this.calls.push({ messages: [...messages], tools });
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      return { content: step.content || '', toolCalls: step.toolCalls || [], usage: null };
    },
  };
}
