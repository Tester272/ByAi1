// server/src/llm/errors.js
export class LLMError extends Error {
  constructor(message, { status, provider, body } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.provider = provider;
    this.body = body;
  }
}

export async function readError(res) {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  return body.slice(0, 2000);
}
