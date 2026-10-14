// server/src/tools/registry.js
// A tiny tool registry. Tools are described in OpenAI function-call JSON-schema
// form so every LLM adapter can consume them directly.
export class ToolRegistry {
  constructor(defs = []) {
    this.map = new Map();
    if (defs.length) this.registerAll(defs);
  }

  register(def) {
    if (!def || !def.name || typeof def.handler !== 'function') {
      throw new Error('Invalid tool definition: name + handler are required');
    }
    this.map.set(def.name, def);
    return this;
  }

  registerAll(defs) {
    for (const d of defs) this.register(d);
    return this;
  }

  has(name) {
    return this.map.has(name);
  }

  get(name) {
    return this.map.get(name);
  }

  names() {
    return [...this.map.keys()];
  }

  /** Tool schemas for the model. */
  list({ exclude = [] } = {}) {
    return [...this.map.values()]
      .filter((d) => !exclude.includes(d.name))
      .map((d) => ({
        type: 'function',
        function: { name: d.name, description: d.description, parameters: d.parameters },
      }));
  }

  /** Human-friendly metadata for the UI. */
  describe() {
    return [...this.map.values()].map((d) => ({
      name: d.name,
      description: d.description,
      category: d.category || 'general',
      dangerous: !!d.dangerous,
    }));
  }

  async execute(name, args, ctx = {}) {
    const def = this.map.get(name);
    if (!def) throw new Error(`Unknown tool: ${name}`);
    return def.handler(args || {}, ctx);
  }
}

export function defineTool(name, description, parameters, handler, meta = {}) {
  return { name, description, parameters, handler, ...meta };
}

export function stringParam(description, extra = {}) {
  return { type: 'string', description, ...extra };
}
