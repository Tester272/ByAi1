// mobile/src/lib/api.ts
// Typed client for the MobileAgent server. Pure TypeScript (only uses fetch),
// so it can be unit-tested outside React Native.

export type Role = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role | 'system';
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
}

export interface AgentEvent {
  type: string;
  step?: number;
  content?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  name?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: boolean | string;
}

export interface AgentResult {
  done: boolean;
  reason?: string;
  content: string;
  steps: number;
  events: AgentEvent[];
}

export interface Task {
  id: string;
  goal: string;
  status: 'queued' | 'running' | 'done' | 'paused' | 'failed' | 'cancelled' | 'cancelling';
  steps: number;
  max_steps: number;
  plan: string[];
  result: { text?: string } | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface Settings {
  llm: { provider: string; model: string; baseUrl: string; apiKey: string };
  keys: { composioApiKey: string; tavilyApiKey: string };
}

export interface ServerConfig {
  providers: string[];
  defaultModel: string;
  hasLlmKey: boolean;
  hasComposioKey: boolean;
  hasTavilyKey: boolean;
  llm: { provider: string; model: string };
}

export class AgentClient {
  constructor(
    public baseUrl: string,
    private fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const message = (body && (body as any).error) || body || `HTTP ${res.status}`;
      throw new Error(String(message));
    }
    return body as T;
  }

  getConfig() {
    return this.request<ServerConfig>('/api/config');
  }

  runAgent(messages: ChatMessage[], maxSteps?: number) {
    return this.request<AgentResult>('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ messages, maxSteps }),
    });
  }

  listTasks() {
    return this.request<{ tasks: Task[] }>('/api/tasks').then((r) => r.tasks);
  }

  getTask(id: string) {
    return this.request<Task>(`/api/tasks/${id}`);
  }

  createTask(goal: string, maxSteps = 25) {
    return this.request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ goal, maxSteps }),
    });
  }

  cancelTask(id: string) {
    return this.request<{ ok: boolean }>(`/api/tasks/${id}/cancel`, { method: 'POST' });
  }

  resumeTask(id: string) {
    return this.request<{ ok: boolean }>(`/api/tasks/${id}/resume`, { method: 'POST' });
  }

  getSettings() {
    return this.request<Settings>('/api/settings');
  }

  saveSettings(payload: Partial<Settings>) {
    return this.request<{ ok: boolean }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  getMemories() {
    return this.request<{ memories: { id: string; content: string; tags: string[] }[] }>(
      '/api/memories',
    ).then((r) => r.memories);
  }
}
