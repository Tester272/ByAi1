# MobileAgent 📱🤖

A **mobile AI agent that uses your own API keys** (BYOK). It can browse and read **any website**, call **any HTTP API**, operate **any app** (Gmail, Slack, GitHub, Notion, Sheets, Calendar… via Composio), remember things long-term, and run **long background tasks** that survive restarts.

```
┌──────────────────────┐        HTTPS/JSON + SSE        ┌───────────────────────────┐
│  Mobile client        │  ───────────────────────────▶  │  Agent server (Node.js)   │
│  • Expo React Native  │                                │  • LLM providers (BYOK)   │
│  • Installable PWA    │  ◀───────────────────────────  │  • Tool system            │
└──────────────────────┘        streamed agent steps     │  • Long-task engine       │
                                                          └─────────────┬─────────────┘
                                                                        │
                       any website / API / app / memory ◀───────────────┘
```

## Why it fits the brief

| Requirement | How it is met |
| --- | --- |
| **Mobile AI agent** | Expo React Native app (`mobile/`) **and** an installable mobile-first PWA served at `/`. |
| **Uses API keys** | Bring your own key for OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint (Groq, OpenRouter, Ollama…). Optional Composio + Tavily keys. Keys are stored server-side and masked in the UI. |
| **Can use any app / website** | `web_fetch` (any URL), `web_search`, `http_request` (any REST API), and `composio_search`/`composio_execute` for **500+ real apps**. |
| **Do long tasks** | A persistent SQLite-backed **task engine** runs goals autonomously in the background, checkpoints its transcript after every step, and re-queues interrupted tasks on restart. |

## Repository layout

```
server/                     Agent server (Node.js, ESM, zero-build)
  src/llm/                  Provider adapters + key resolution (BYOK)
  src/tools/                Tool system: web, apps (Composio), memory, tasks
  src/agent/loop.js         Core think -> act -> observe agent loop
  src/agent/worker.js       Long-task background engine (resumable)
  src/store/db.js           Persistence on Node's built-in SQLite
  src/app.js                HTTP + SSE API
  src/index.js              Bootstrap
  public/                   Installable mobile-first PWA client
  scripts/mock-llm.js       Mock OpenAI-compatible LLM for local demos
  test/                     32 tests (node:test)
mobile/                     Expo React Native app
  App.tsx, src/screens/     Chat, Tasks, Settings screens
  src/lib/api.ts            Typed API client
  test/                     API client tests
```

## Quick start

### 1. Start the agent server

```bash
npm run install:all          # installs server + mobile deps
npm --prefix server start    # http://localhost:8787
```

Open `http://localhost:8787` on your phone (or desktop) — that's the PWA. Add it to your home screen to use it like a native app.

### 2. Add your API keys

Open **Settings** in the app (or set env vars, see `.env.example`):

- **Provider** – `openai`, `anthropic`, `gemini`, or `openai-compatible`
- **Model** – e.g. `gpt-4o-mini`, `claude-3-5-sonnet-latest`, `gemini-1.5-flash`
- **LLM API key** – your key
- **Base URL** – only for `openai-compatible` (e.g. `http://localhost:11434/v1` for Ollama)
- **Composio API key** *(optional)* – unlocks any-app control
- **Tavily API key** *(optional)* – higher-quality web search (DuckDuckGo is the keyless fallback)

### 3. Run the mobile app (optional native client)

```bash
npm --prefix mobile start    # then press a / i / scan the QR with Expo Go
```

In the app's **Settings**, set the server URL to your machine (e.g. `http://192.168.1.10:8787`).

### Try it without a real LLM key

```bash
node server/scripts/mock-llm.js 9911     # terminal 1
LLM_PROVIDER=openai-compatible LLM_BASE_URL=http://127.0.0.1:9911/v1 \
  LLM_API_KEY=fake npm --prefix server start   # terminal 2
```


## The tool system

| Tool | What it does |
| --- | --- |
| `web_fetch` | Read **any** URL (text / html / json / links). |
| `web_search` | Web search (Tavily if key set, else DuckDuckGo). |
| `http_request` | Any HTTP method to **any** API with headers/body. |
| `composio_search` / `composio_execute` | Find & run actions on **any app** (Gmail, Slack, GitHub…). |
| `memory_save` / `memory_recall` | Long-term memory across sessions. |
| `task_create` / `task_list` / `task_status` | Start & track **long background tasks**. |
| `task_update` / `finish_task` | Plan updates & completion inside a long task. |
| `current_time` | Current date/time. |

Add your own tool in `server/src/tools/` and register it in `buildDefaultTools()`.

## HTTP API

| Method & path | Purpose |
| --- | --- |
| `POST /api/chat` | **SSE stream** of agent steps (`thinking`, `assistant`, `tool`, `done`). |
| `POST /api/agent` | Same, non-streaming JSON (used by the RN app). |
| `GET /api/health`, `/api/config`, `/api/tools` | Metadata. |
| `GET`/`PUT /api/settings` | Read/save BYOK keys (masked on read). |
| `GET`/`POST /api/memories` | Long-term memory. |
| `GET`/`POST /api/tasks`, `GET /api/tasks/:id` | Long tasks. |
| `POST /api/tasks/:id/cancel`, `/resume` | Control a long task. |
| `GET /api/tasks/:id/stream` | Live SSE of a task's progress. |

## How long tasks work

1. The agent (or you) calls `task_create` / `POST /api/tasks` with a goal.
2. The **worker** picks up queued tasks, runs the agent loop with a task-specific system prompt, and calls `onCheckpoint` after every step to persist the transcript and step count.
3. When the model calls `finish_task`, the task is marked `done` with the result. If it hits the step cap it is **paused** and can be **resumed**.
4. On startup, tasks that were `running` when the process died are **re-queued** (`requeueInterrupted`), so long work survives restarts.

## Tests

```bash
npm test              # server (32) + mobile (5)
npm run test:server
npm run test:mobile
```

The suite covers provider request/response mapping, tool behaviour, the agent loop (including tool errors, step caps and checkpoints), the long-task engine (completion, pause/resume, cancel, restart), and the full HTTP/SSE API.

## Configuration

See `.env.example`. All keys are optional and can be supplied per-request from the app.

## License

MIT
