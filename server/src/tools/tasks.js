// server/src/tools/tasks.js
// Long-task tools. The agent can hand off big goals to the background task
// engine (which keeps running, checkpoints progress and survives restarts),
// and - while running inside a task - can update its plan and finish itself.
import { defineTool } from './registry.js';

export function createTaskTools() {
  const create = defineTool(
    'task_create',
    'Create a LONG-RUNNING background task for a large goal (e.g. "research X and write a report", "monitor Y and message me"). The task runs autonomously, keeps its own plan and transcript, and survives restarts. Returns the task id to track progress.',
    {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'A clear, self-contained description of the end goal.' },
        maxSteps: { type: 'number', description: 'Maximum agent steps before pausing (default 25).' },
        context: { type: 'string', description: 'Optional background/context to seed the task.' },
      },
      required: ['goal'],
    },
    async ({ goal, maxSteps = 25, context = '' }, ctx = {}) => {
      if (!ctx.store) throw new Error('task_create requires a store in context');
      const task = ctx.store.createTask({
        userId: ctx.userId || 'local',
        goal,
        maxSteps,
        config: { seedContext: context, llm: ctx.llmConfig || null },
      });
      ctx.onTaskCreated?.(task);
      return { taskId: task.id, status: task.status, goal: task.goal };
    },
    { category: 'tasks' },
  );

  const list = defineTool(
    'task_list',
    'List background/long-running tasks and their status.',
    {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max tasks to return (default 20).' },
      },
    },
    async ({ limit = 20 }, ctx = {}) => {
      if (!ctx.store) throw new Error('task_list requires a store in context');
      const tasks = ctx.store.listTasks(ctx.userId || 'local', limit);
      return {
        count: tasks.length,
        tasks: tasks.map((t) => ({ id: t.id, goal: t.goal, status: t.status, steps: t.steps })),
      };
    },
    { category: 'tasks' },
  );

  const status = defineTool(
    'task_status',
    'Get the full status, plan and result of a background task by id.',
    {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'The task id.' } },
      required: ['taskId'],
    },
    async ({ taskId }, ctx = {}) => {
      if (!ctx.store) throw new Error('task_status requires a store in context');
      const t = ctx.store.getTask(taskId);
      if (!t) throw new Error(`No task with id ${taskId}`);
      return { id: t.id, goal: t.goal, status: t.status, plan: t.plan, steps: t.steps, result: t.result };
    },
    { category: 'tasks' },
  );

  const update = defineTool(
    'task_update',
    'While running a long task, record/refresh your plan and progress notes so the run is resumable and visible to the user.',
    {
      type: 'object',
      properties: {
        plan: { type: 'array', items: { type: 'string' }, description: 'Ordered list of remaining/overall steps.' },
        note: { type: 'string', description: 'A short progress note.' },
      },
    },
    async ({ plan, note }, ctx = {}) => {
      if (!ctx.store || !ctx.taskId) throw new Error('task_update is only available inside a running task');
      const patch = {};
      if (Array.isArray(plan)) patch.plan = plan;
      if (note) patch.transcript = [...(ctx.transcript || []), { role: 'note', content: note }];
      const t = ctx.store.updateTask(ctx.taskId, patch);
      return { updated: true, plan: t.plan };
    },
    { category: 'tasks' },
  );

  const finish = defineTool(
    'finish_task',
    'Signal that the current long task (or chat turn) is complete and provide the final result/summary for the user.',
    {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'The final answer / deliverable / summary.' },
      },
      required: ['result'],
    },
    async ({ result }, ctx = {}) => {
      ctx.finished = { result };
      return { done: true, result };
    },
    { category: 'tasks' },
  );

  return [create, list, status, update, finish];
}
