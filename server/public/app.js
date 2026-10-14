// public/app.js — MobileAgent PWA client
const $ = (sel) => document.querySelector(sel);
const api = async (path, opts) => {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || body || `HTTP ${res.status}`);
  return body;
};

const setStatus = (t) => ($('#status').textContent = t);

// ---------- tabs ----------
document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $('#view-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'tasks') loadTasks();
    if (btn.dataset.tab === 'settings') loadSettings();
  });
});

// ---------- SSE helper ----------
function parseSSE(chunk) {
  const lines = chunk.split('\n');
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  let parsed = null;
  try {
    parsed = data ? JSON.parse(data) : null;
  } catch {
    parsed = data;
  }
  return { event, data: parsed };
}

async function streamSSE(url, { onEvent, body } = {}) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (raw.trim()) onEvent(parseSSE(raw));
    }
  }
}

// ---------- chat ----------
const messages = $('#messages');
const history = [];

function clearEmpty() {
  const empty = messages.querySelector('.empty');
  if (empty) empty.remove();
}

function addMessage(role, text, extra = '') {
  clearEmpty();
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.innerHTML = extra + escapeHtml(text);
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

let busy = false;

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  history.push({ role: 'user', content: text });
  addMessage('user', text);
  busy = true;
  $('#send').disabled = true;
  setStatus('thinking…');

  try {
    await streamSSE('/api/chat', {
      body: { messages: history },
      onEvent: ({ event, data }) => {
        if (event === 'assistant') {
          if (data.content) addMessage('assistant', data.content);
          for (const tc of data.toolCalls || []) {
            addMessage('tool', `→ ${tc.name}(${JSON.stringify(tc.args)})`, '');
          }
        } else if (event === 'tool') {
          const summary = data.error
            ? `⚠ ${data.name} failed: ${data.result?.error || 'error'}`
            : `← ${data.name} ok`;
          const last = messages.lastElementChild;
          if (last && last.classList.contains('tool')) last.textContent = `→ ${data.name}  ${summary}`;
        } else if (event === 'done') {
          if (data.content) history.push({ role: 'assistant', content: data.content });
          setStatus(data.done ? 'done' : data.reason || 'stopped');
        } else if (event === 'error') {
          addMessage('error', 'Error: ' + data.error);
          setStatus('error');
        }
      },
    });
  } catch (err) {
    addMessage('error', err.message);
    setStatus('error');
  } finally {
    busy = false;
    $('#send').disabled = false;
  }
});

// quick-prompt chips
document.querySelectorAll('.chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    $('#chat-input').value = chip.dataset.prompt;
    $('#chat-form').requestSubmit();
  }),
);

// ---------- tasks ----------
const taskList = $('#task-list');
let taskPoll = null;

async function loadTasks() {
  const { tasks } = await api('/api/tasks');
  renderTasks(tasks);
  if (taskPoll) clearInterval(taskPoll);
  taskPoll = setInterval(async () => {
    if (!$('#view-tasks').classList.contains('active')) return;
    try {
      renderTasks((await api('/api/tasks')).tasks);
    } catch {
      /* ignore */
    }
  }, 2500);
}

function renderTasks(tasks) {
  if (!tasks.length) {
    taskList.innerHTML =
      '<p class="hint" style="padding:0 14px">No tasks yet. Create one above — it runs in the background and survives restarts.</p>';
    return;
  }
  taskList.innerHTML = '';
  for (const t of tasks) {
    const el = document.createElement('div');
    el.className = 'item';
    const result = t.result?.text ? `<div class="result">${escapeHtml(t.result.text)}</div>` : '';
    const err = t.error ? `<div class="result">${escapeHtml(t.error)}</div>` : '';
    const canCancel = ['queued', 'running', 'paused'].includes(t.status);
    const canResume = ['paused', 'failed', 'cancelled'].includes(t.status);
    el.innerHTML = `
      <div class="goal">${escapeHtml(t.goal)}</div>
      <div class="meta">
        <span class="badge ${t.status}">${t.status}</span>
        <span class="muted">step ${t.steps}/${t.max_steps}</span>
      </div>
      ${result}${err}
      <div class="actions">
        ${canCancel ? `<button class="danger" data-cancel="${t.id}">Cancel</button>` : ''}
        ${canResume ? `<button class="ghost" data-resume="${t.id}">Resume</button>` : ''}
      </div>`;
    taskList.appendChild(el);
  }
  taskList.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/tasks/${b.dataset.cancel}/cancel`, { method: 'POST' });
      loadTasks();
    }),
  );
  taskList.querySelectorAll('[data-resume]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/tasks/${b.dataset.resume}/resume`, { method: 'POST' });
      loadTasks();
    }),
  );
}

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const goal = $('#task-goal').value.trim();
  if (!goal) return;
  const maxSteps = Number($('#task-steps').value) || 25;
  setStatus('creating task…');
  try {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify({ goal, maxSteps }) });
    $('#task-goal').value = '';
    setStatus('task queued');
    loadTasks();
  } catch (err) {
    setStatus('error: ' + err.message);
  }
});

// ---------- settings ----------
async function loadSettings() {
  const s = await api('/api/settings');
  $('#s-provider').value = s.llm.provider || 'openai';
  $('#s-model').value = s.llm.model || '';
  $('#s-baseurl').value = s.llm.baseUrl || '';
  $('#s-apikey').placeholder = s.llm.apiKey || 'sk-…';
  $('#s-composio').placeholder = s.keys.composioApiKey || 'optional';
  $('#s-tavily').placeholder = s.keys.tavilyApiKey || 'optional';
  const { memories } = await api('/api/memories');
  $('#memory-list').innerHTML = memories.length
    ? memories
        .map(
          (m) =>
            `<div class="item"><div>${escapeHtml(m.content)}</div><div class="muted">${(m.tags || []).join(', ')}</div></div>`,
        )
        .join('')
    : '<p class="hint">Nothing remembered yet.</p>';
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const llm = {
    provider: $('#s-provider').value,
    model: $('#s-model').value.trim(),
    baseUrl: $('#s-baseurl').value.trim(),
  };
  const apiKey = $('#s-apikey').value.trim();
  if (apiKey) llm.apiKey = apiKey;
  const keys = {};
  const composio = $('#s-composio').value.trim();
  const tavily = $('#s-tavily').value.trim();
  if (composio) keys.composioApiKey = composio;
  if (tavily) keys.tavilyApiKey = tavily;
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ llm, keys }) });
    $('#s-apikey').value = '';
    $('#s-composio').value = '';
    $('#s-tavily').value = '';
    setStatus('settings saved');
    loadSettings();
  } catch (err) {
    setStatus('error: ' + err.message);
  }
});

// ---------- init ----------
(async function init() {
  try {
    const cfg = await api('/api/config');
    setStatus(cfg.hasLlmKey ? 'ready' : 'add your API key in Settings');
  } catch {
    setStatus('server offline');
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();

