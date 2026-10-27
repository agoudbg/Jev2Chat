# Jev2Chat

A local-first Choice laboratory for recursive text generation with Jev. Each model request selects one vocabulary option; the generator appends its exact value or stops on an end option. The interface is in Simplified Chinese.

Built with Next.js App Router, React, strict TypeScript, Tailwind CSS, official shadcn/ui components, and Lucide React. There are no accounts or application database. Public shared credentials require a shared Redis quota store.

## Run locally

Requirements: Node.js 22 or newer (verified with Node.js 24), pnpm 9.15.0, and an optional TypeSafe API Token for real generation.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). On macOS/Linux, use `cp .env.example .env.local` instead of `Copy-Item`.

1. Open **模型连接**, keep **Jev · TypeSafe v1**, and choose a transport. The default backend proxy accepts `https://api.typesafe.ai`.
2. Enter your Token and model ID, then test the connection. The test calls the authenticated models endpoint and checks that your model exists; it does not generate text.
3. Save settings. Credentials remain in page memory unless you explicitly enable browser storage.
4. Enter a prompt, select a vocabulary, review the maximum request count, and start.
5. Inspect each round in **Questions**. Pause after the active request, stop immediately, or edit State to cancel an obsolete response and change the next context.

Without a Token, choose **Mock · 仅开发测试** in the development server. This deterministic HTTP provider returns the first eight text candidates in order, then an end candidate if present. Its banner and round records explicitly identify Mock. It does not evaluate the prompt, and its endpoint is disabled in production. Real Jev generation has no fallback to Mock.

## What is implemented

- Editable State, exact JSON string source editing, automatic scrolling, copy, confirmed clearing, and TXT/Markdown/complete JSON/trace exports.
- Pause, resume, immediate cancellation, restart from current State, finite rounds and character limits, bounded retries, timeouts, inter-request delay, and stop strings.
- Printable ASCII U+0020–U+007E enabled by default, optional LF/CR/Tab, and an application-level EOS candidate.
- Named, versioned vocabulary libraries with independent display labels, values and option keys; batch editing, search, category selection, pagination, and JSON import/export.
- Character, string, and custom token units. Token mode accepts your string units; it does not use an undocumented model tokenizer.
- Round inspection with the actual question, State revision, transmitted State, selected key, exact append, probabilities, timing, attempt errors, and sanitized request/response JSON.
- Browser-direct BYOK, backend-proxy BYOK, and optional administrator-funded public mode.
- Multiple local tasks, task import, light/dark themes, resizable desktop panes and a mobile layout.

The default budget is 64 rounds with no automatic retries and a 4,096-code-point text limit. A long run over 256 potential requests requires confirmation. Each request sends growing context and the enabled vocabulary; the count is an upper bound on requests, not a price estimate.

## Confirmed Jev protocol

The production adapter implements the documented TypeSafe v1 contract:

- `POST https://api.typesafe.ai/v1/systemone`, authenticated with `Authorization: Bearer <token>`.
- JSON containing `model`, structured `state`, and named Choice `questions` with `type`, `instructions`, and `criteria`.
- `answers.next_content.choice` returns an option key, together with confidence, probabilities and usage.
- At most 255 options per Choice. The app requires 2–255 enabled candidates and refuses oversized lists; it never samples or truncates them silently.
- EOS is an application-defined finish action. Empty responses and invalid keys are errors.

See [the exact protocol, sources and compatibility limits](docs/choice-protocol.md). Custom origins and endpoint paths support the **same** contract. An OpenAI-compatible chat endpoint needs a separate adapter. Browser CORS support and account/model availability must be checked with your service.

No real Token is included. Automated tests mock the network boundary, and development Mock does not establish real-model writing quality, latency, billing, or live acceptance.

## Storage and exports

| Data                                                                 | Location                                | Behavior                                                                 |
| -------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| Tasks, prompt, exact State, vocabulary snapshots, full round history | IndexedDB `jev2chat`, store `workspace` | Autosaved to this browser; interrupted tasks restore paused              |
| Named vocabulary library                                             | Same IndexedDB workspace                | Task snapshots retain their own version                                  |
| Non-sensitive connection settings                                    | `localStorage`, `jev2chat.settings.v1`  | Restored on refresh                                                      |
| BYOK Token and extra headers                                         | Page memory by default                  | Lost on refresh                                                          |
| Opted-in BYOK credentials                                            | `localStorage`, `jev2chat.secrets.v1`   | Plaintext; explicitly enabled and removable by disabling the switch      |
| Public Token                                                         | Server environment only                 | Never returned by the config or connection API                           |
| Theme                                                                | Browser storage managed by next-themes  | Restored on refresh                                                      |
| Public quota and response deduplication                              | Shared Upstash Redis                    | Expiring metadata and validated model answers; no prompt or State bodies |

Browser storage is not encrypted. Page scripts, extensions or another person using this browser may access it. Exported task/trace JSON includes prompts, State and round payloads. Credentials are excluded from these payloads, but text you deliberately place in a prompt or vocabulary remains your content. Treat exports as private when appropriate.

The library supports up to 30 tasks, 50 vocabularies, 5,000 history rounds per task and 5,000 stored candidates per vocabulary; only 255 may be enabled. Import files are limited to 10 MiB. Storage quota failures are surfaced without silently replacing the old workspace. Export before deleting browser data. Multiple tabs do not collaboratively merge changes; use one tab per workspace to avoid last-writer conflicts.

TXT and Markdown exports contain the exact State without added front matter, whitespace cleanup or newline conversion. JSON escapes control characters reversibly. HTML textareas normalize carriage returns, so State containing CR is read-only in the text view; edit its JSON source to retain CR and CRLF accurately.

Source edits stay in a draft until applied. Generation and task switching are disabled while that draft is pending, and leaving the source view asks before discarding it. This prevents the displayed draft and submitted State from silently diverging.

## Project layout

| Path                                            | Responsibility                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `src/app/`                                      | App shell, metadata, theme styling, page and HTTP route handlers           |
| `src/components/ui/`                            | Official shadcn/ui primitives (Radix, New York style)                      |
| `src/components/workspace/`                     | Configuration, State, Questions, connection settings and vocabulary editor |
| `src/lib/domain.ts`                             | Validated task, option, vocabulary and settings models                     |
| `src/lib/provider.ts`                           | Provider-independent Choice interfaces and error semantics                 |
| `src/lib/jev-protocol.ts`                       | TypeSafe request serializer and response parser                            |
| `src/lib/jev-provider.ts`                       | Direct, proxy, public and development transports                           |
| `src/lib/generator.ts`                          | Recursive generation, cancellation, revision checks and stop rules         |
| `src/lib/vocabulary.ts`                         | Built-in ASCII and vocabulary validation/import                            |
| `src/lib/model-settings.ts`                     | Settings and explicit credential storage policy                            |
| `src/lib/task-storage.ts`, `workspace-store.ts` | IndexedDB persistence and task lifecycle                                   |
| `src/server/`                                   | Environment validation, proxy boundaries and shared atomic quotas          |
| `tests/`                                        | Unit, integration, Lua/Redis boundary and browser regression tests         |
| `docs/`                                         | Protocol and deployment/security guidance                                  |

## Verify

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm check` runs formatting, lint, TypeScript and unit/integration tests. Browser tests use the installed Google Chrome channel in an isolated profile and start the production server on port 3017 after `pnpm build`. The development-only Mock test is skipped against production, where its endpoint must be disabled. To include that test, run against a development server or set `$env:JEV_E2E_DEVELOPMENT="true"` in PowerShell (`JEV_E2E_DEVELOPMENT=true pnpm test:e2e` on macOS/Linux). For CI, install Chrome with `pnpm exec playwright install --with-deps chrome`. Traces and failure screenshots are in `test-results/`; the HTML report is in `playwright-report/`.

Network tests replace `fetch` or intercept HTTP requests; core generation, serialization, persistence and state transitions remain real. Public quota tests execute the production Lua scripts in Wasmoon and replace only Redis commands. This checks atomic decision behavior but does not replace an integration check against your deployed Redis service.

See [the validation record](docs/validation.md) for the checks run on the delivered source and the service-dependent acceptance limits.

## Build and deploy

```powershell
pnpm build
pnpm start
```

The application requires a Node.js runtime; a static export cannot run its proxy. The default build supports `pnpm start`. Docker sets `JEV_STANDALONE_BUILD=true` during its build and runs the resulting standalone `server.js` with static assets copied into place. `.env.local` is for local use; set production secrets through your hosting platform or secret manager.

```powershell
docker build -t jev2chat .
docker run --rm -p 3000:3000 --env-file .env.local jev2chat
```

For a managed Next.js host, set the install command to `pnpm install --frozen-lockfile`, the build command to `pnpm build`, and configure the same server environment variables. No credential needs a `NEXT_PUBLIC_` prefix. Set the platform's request timeout above `JEV_UPSTREAM_TIMEOUT_MS` with headroom for Redis and response delivery. One Choice is one HTTP call; a long generation runs in the browser across many calls.

Public mode is **off by default**. See [deployment and public quota configuration](docs/deployment.md) before enabling it, including trusted proxy IP handling, shared Redis, access restrictions, and operational limits.
