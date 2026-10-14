// server/src/agent/worker.js
// Background engine for LONG tasks. It polls the task table, runs each queued
// task through the agent loop, checkpoints the transcript after every step and
// re-queues interrupted tasks on restart so long work survives crashes.
import { EventEmitter } from 'node:events';
import { runAgentLoop } from './loop.js';
import { buildTaskPrompt } from './prompts.js';
import { log } from '../util/logger.js';

export class TaskWorker extends EventEmitter {
  constructor({ store, registry, resolveLLM, pollMs = 750, concurrency = 1, maxSteps = 25 }) {
    super();
    this.store = store;
    this.registry = registry;
    this.resolveLLM = resolveLLM;
    this.pollMs = pollMs;
    this.concurrency = concurrency;
    this.maxSteps = maxSteps;
    this.active = new Map(); // taskId -> AbortController
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const requeued = this.store.requeueInterrupted();
    if (requeued) log.info(`task worker re-queued ${requeued} interrupted task(s)`);
    this.timer = setInterval(() => this.tick(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
    this.tick();
    log.info('task worker started');
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const ctrl of this.active.values()) ctrl.abort();
    this.active.clear();
  }

  emitEvent(taskId, type, data) {
    try {
      const id = this.store.addEvent({ taskId, type, data });
      this.emit('event', { id, taskId, type, data, created_at: Date.now() });
    } catch (e) {
      log.warn('failed to record event', e.message);
    }
  }

  tick() {
    if (!this.running) return;
    while (this.active.size < this.concurrency) {
      const task = this.store.nextQueuedTask();
      if (!task) return;
      // claim it synchronously so two ticks can't grab the same task
      this.store.updateTask(task.id, { status: 'running', started_at: Date.now() });
      const ctrl = new AbortController();
      this.active.set(task.id, ctrl);
      this.runTask(task, ctrl).finally(() => this.active.delete(task.id));
    }
  }

  cancel(taskId) {
    const ctrl = this.active.get(taskId);
    if (ctrl) {
      this.store.updateTask(taskId, { status: 'cancelling' });
      ctrl.abort();
      return true;
    }
    const task = this.store.getTask(taskId);
    if (task && ['queued', 'paused'].includes(task.status)) {
      this.store.updateTask(taskId, { status: 'cancelled', finished_at: Date.now() });
      return true;
    }
    return false;
  }

  resume(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) return false;
    if (!['paused', 'failed', 'cancelled'].includes(task.status)) return false;
    this.store.updateTask(taskId, { status: 'queued', error: null });
    return true;
  }

  async runTask(task, ctrl) {
    log.info(`task ${task.id} starting: ${task.goal}`);
    this.emitEvent(task.id, 'task_started', { goal: task.goal });
    try {
      const llm = this.resolveLLM(task);
      const memories = this.store.listMemories(task.user_id, 20);
      const messages = [{ role: 'system', content: buildTaskPrompt({ task, memories }) }];
      if (task.config?.seedContext) {
        messages.push({
          role: 'user',
          content: `Context provided by the user:\n${task.config.seedContext}`,
        });
      }
      messages.push({ role: 'user', content: task.goal });

      const ctx = {
        store: this.store,
        userId: task.user_id,
        taskId: task.id,
        llmConfig: task.config?.llm || null,
      };

      const result = await runAgentLoop({
        llm,
        registry: this.registry,
        messages,
        ctx,
        emit: (ev) => this.emitEvent(task.id, ev.type, ev),
        onCheckpoint: (transcript, steps) => {
          this.store.updateTask(task.id, { transcript: transcript.slice(-200), steps });
        },
        maxSteps: task.max_steps || this.maxSteps,
        signal: ctrl.signal,
      });

      const finishedAt = Date.now();
      if (result.reason === 'aborted') {
        const fresh = this.store.getTask(task.id);
        if (fresh?.status === 'cancelling') {
          this.store.updateTask(task.id, { status: 'cancelled', finished_at: finishedAt });
          this.emitEvent(task.id, 'task_cancelled', {});
        } else {
          this.store.updateTask(task.id, { status: 'paused', finished_at: finishedAt });
          this.emitEvent(task.id, 'task_paused', { reason: 'aborted' });
        }
        return;
      }

      if (result.done) {
        this.store.updateTask(task.id, {
          status: 'done',
          result: { text: result.content },
          transcript: result.transcript.slice(-200),
          steps: result.steps,
          finished_at: finishedAt,
        });
        this.emitEvent(task.id, 'task_done', { result: result.content });
        log.info(`task ${task.id} done in ${result.steps} step(s)`);
      } else {
        this.store.updateTask(task.id, {
          status: 'paused',
          transcript: result.transcript.slice(-200),
          steps: result.steps,
          finished_at: finishedAt,
        });
        this.emitEvent(task.id, 'task_paused', { reason: result.reason });
      }
    } catch (err) {
      log.error(`task ${task.id} failed:`, err.message);
      this.store.updateTask(task.id, {
        status: 'failed',
        error: err.message,
        finished_at: Date.now(),
      });
      this.emitEvent(task.id, 'task_failed', { error: err.message });
    }
  }
}
