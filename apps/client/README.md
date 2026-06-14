# 05_02_ui

A production-grade **Svelte 5 streaming chat UI** backed by a **Bun HTTP server** with OpenAI integration and mocked tool execution.

Proves the front-end architecture for:

- very long chat histories (virtualized, 1500+ messages)
- streamed assistant text with typewriter animation
- thinking / reasoning block rendering
- tool call / tool result cards
- artifact previews (markdown, JSON, text, files)
- event-sourced block materialization

## Architecture

```
Browser (Svelte 5 + Tailwind 4)
│
│  POST /api/chat → SSE stream
│  GET  /api/conversation → JSON snapshot
│
└─► Bun HTTP Server (:3300)
    ├─ Mock mode  — deterministic scenarios, zero latency
    └─ Live mode  — OpenAI Responses API, tool loop (max 6 steps)
```

**Data flow:** `StreamEvent` (SSE) → rAF batching → `applyEvent` (O(1) per event) → Svelte 5 reactivity → block components.

## Project structure

```
├── src/                        # Svelte 5 frontend
│   ├── App.svelte              # Root: header, composer, mode selector
│   ├── lib/
│   │   ├── components/         # UI blocks
│   │   │   ├── VirtualMessageList.svelte
│   │   │   ├── MessageCard.svelte
│   │   │   ├── BlockRenderer.svelte
│   │   │   ├── TextBlock.svelte
│   │   │   ├── ThinkingBlock.svelte
│   │   │   ├── ToolBlock.svelte
│   │   │   ├── ArtifactBlock.svelte
│   │   │   ├── ErrorBlock.svelte
│   │   │   └── MarkdownHtml.svelte
│   │   ├── runtime/            # Streaming engine
│   │   │   ├── materialize.ts          # StreamEvent → Block[]
│   │   │   ├── parse-blocks.ts         # Markdown → block-level units
│   │   │   ├── streaming-markdown.ts   # Incremental markdown parser
│   │   │   ├── incomplete-markdown.ts  # Repairs partial markdown
│   │   │   ├── with-raf-batching.ts    # rAF-based event coalescing
│   │   │   ├── scroll-controller.ts    # Auto-scroll / pin-to-bottom
│   │   │   └── format.ts
│   │   ├── services/
│   │   │   ├── api.ts          # HTTP client for /api/*
│   │   │   ├── sse.ts          # SSE frame parser
│   │   │   └── markdown.ts     # markdown-it + hljs + DOMPurify
│   │   ├── stores/
│   │   │   ├── chat-store.svelte.ts    # Main reactive store
│   │   │   └── typewriter.svelte.ts    # Animation speed control
│   │   └── utils/
│   │       └── perf.ts         # Dev-only performance tracker
│
├── server/                     # Bun HTTP backend
│   ├── index.ts                # HTTP router & SSE streaming
│   ├── agent/
│   │   ├── run.ts              # Agentic loop (async generator)
│   │   ├── events.ts           # Event factory
│   │   ├── input.ts            # Conversation → OpenAI input
│   │   ├── prompt.ts           # System prompt builder
│   │   └── types.ts
│   ├── ai/
│   │   ├── client.ts           # OpenAI SDK wrapper
│   │   └── config.ts           # Env-based provider config
│   ├── tools/                  # Mocked tool implementations
│   │   ├── sales.ts            # getSalesReport, renderChart
│   │   ├── email.ts            # sendEmail, lookupContactContext
│   │   ├── notes.ts            # searchNotes
│   │   ├── artifacts.ts        # createArtifact
│   │   └── shared.ts
│   ├── mock/                   # Deterministic mock mode
│   │   ├── scenarios.ts
│   │   ├── builder.ts
│   │   └── index.ts
│   ├── conversation/
│   │   └── store.ts            # In-memory conversation state
│   ├── http/
│   │   ├── schemas.ts          # Zod request schemas
│   │   └── validation.ts
│   └── data/                   # Mock datasets
│       ├── products.ts
│       ├── contacts.ts
│       ├── notes.ts
│       └── mock-content.ts
│
├── shared/                     # Types shared by client & server
│   └── chat.ts                 # StreamEvent, Block, Message unions
│
├── tsconfig.base.json          # Shared TS options
├── tsconfig.app.json           # Frontend (src/ + shared/)
├── tsconfig.server.json        # Backend (server/ + shared/)
├── biome.json                  # Linting & formatting
└── vite.config.ts              # Vite + Tailwind + Svelte
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Svelte 5, Tailwind CSS 4 |
| Markdown | markdown-it, highlight.js, DOMPurify |
| Backend | Bun HTTP server |
| AI | OpenAI Responses API (via `openai` SDK) |
| Validation | Zod |
| Linting | Biome |
| Testing | Bun test runner |
| Types | TypeScript 5.9 (strict) |

## Run

```bash
bun install
bun run dev
```

Starts the Bun API server on `http://localhost:3300` and the Vite dev server on `http://localhost:5173`.

## Build

```bash
bun run build
bun run start
```

## Scripts

| Script | Description |
|---|---|
| `dev` | Start server + UI concurrently |
| `build` | Build both client and server |
| `start` | Run production build |
| `test` | Run tests |
| `test:watch` | Run tests in watch mode |
| `typecheck` | Type-check client (svelte-check) and server (tsc) |
| `lint` | Check with Biome |
| `lint:fix` | Auto-fix lint issues |
| `format` | Check formatting |
| `format:fix` | Auto-fix formatting |

## Modes

- **Mock** (default) — deterministic scenarios for sales, email, artifact, and research turns. No API key needed. History seeding for testing long threads.
- **Live** — real OpenAI Responses API calls with streaming and tool execution.

## Notes

- The conversation list uses chunk-based virtualization with ResizeObserver for smooth scrolling at scale.
- Historical messages are hydrated first; only the newest assistant turn streams live.
- All markdown rendering is incremental — only the live tail is re-parsed during streaming.
- Tool side effects write files into `.data/` (gitignored).
