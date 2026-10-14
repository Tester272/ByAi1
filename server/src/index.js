// server/src/index.js
// Bootstraps the MobileAgent server: store + tools + long-task worker + HTTP API.
import { loadConfig } from './config.js';
import { openStore } from './store/db.js';
import { createRegistry } from './tools/index.js';
import { createLLMResolver } from './llm/resolve.js';
import { TaskWorker } from './agent/worker.js';
import { createApp } from './app.js';
import { log } from './util/logger.js';

export function bootstrap(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const store = openStore(config.dbFile);
  const registry = createRegistry(config);
  const resolveLLM = createLLMResolver({ store, config });
  const worker = new TaskWorker({
    store,
    registry,
    resolveLLM: (task) => resolveLLM({}, task.config?.llm),
    pollMs: config.worker.pollMs,
    concurrency: config.worker.concurrency,
    maxSteps: config.maxSteps,
  });
  const { app } = createApp({ store, config, worker, registry });
  return { config, store, registry, worker, app };
}

export function start() {
  const { config, store, worker, app } = bootstrap();
  worker.start();
  const server = app.listen(config.port, () => {
    log.info(`MobileAgent server listening on http://localhost:${config.port}`);
    log.info(`Data dir: ${config.dataDir}`);
  });
  const shutdown = () => {
    log.info('shutting down...');
    worker.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) start();
