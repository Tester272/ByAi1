// server/src/config.js
import { resolve } from 'node:path';

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig(env = process.env) {
  const dataDir = resolve(env.DATA_DIR || './data');
  return {
    port: int(env.PORT, 8787),
    dataDir,
    dbFile: env.DB_FILE || resolve(dataDir, 'mobile-agent.db'),
    maxSteps: int(env.MAX_STEPS, 25),
    defaultLlm: {
      provider: env.LLM_PROVIDER || '',
      apiKey: env.LLM_API_KEY || '',
      model: env.LLM_MODEL || '',
      baseUrl: env.LLM_BASE_URL || '',
    },
    composioApiKey: env.COMPOSIO_API_KEY || '',
    tavilyApiKey: env.TAVILY_API_KEY || '',
    worker: {
      // how long the long-task worker sleeps between polls
      pollMs: int(env.WORKER_POLL_MS, 750),
      // concurrency for the background task runner
      concurrency: int(env.WORKER_CONCURRENCY, 1),
    },
  };
}
