# Validation record

Verified on Windows on 2026-10-27 with Node.js 24.19.0, pnpm 9.15.0, and the installed Google Chrome channel. Dependencies were installed from the frozen lockfile in an isolated verification copy, not in the delivered source directory.

| Check                                         | Result                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm format:check`                           | Passed                                                                 |
| `pnpm lint`                                   | Passed with zero warnings                                              |
| `pnpm typecheck`                              | Passed                                                                 |
| `pnpm test`                                   | 67 tests passed across six files                                       |
| `pnpm build`                                  | Production build passed                                                |
| `pnpm start`                                  | Production server served the application and API routes                |
| `pnpm test:e2e` against the production server | Seven passed; the development-only Mock test was intentionally skipped |
| Production HTTP smoke checks                  | Eight passed                                                           |

## Scope of the evidence

Unit and integration tests exercise the real generator, serializer, parser, storage adapters, settings behavior, request handlers, and quota scripts. External HTTP calls are replaced at the fetch boundary. IndexedDB tests use fake-indexeddb. Quota tests execute the production Lua scripts with Wasmoon and replace Redis commands at the external storage boundary.

The tests cover printable ASCII, LF/CR/Tab/backslash preservation, EOS, invalid responses, bounded retries, round limits, pause and stop, editing during a pending request, delayed responses, exact exports, vocabulary persistence, credential redaction, public quotas, connection-test invalidation, and refresh recovery. A separate provider integration test sends nine recursive rounds through the actual development Mock handler and verifies that this route is unavailable in production.

Browser tests cover the workspace, theme switching, narrow-screen navigation, connection settings, exact source editing, pause/resume, EOS, cancellation, error display, vocabulary round trips, task isolation, unapplied source drafts, downloads, and refresh. Model HTTP responses in these tests are intercepted. They establish application behavior without making paid requests.

The eight production HTTP checks verify the application page and security headers, the public configuration projection, validation on both model routes, cross-origin rejection, actual request-body size enforcement, production Mock rejection, and disabled public-mode admission. Desktop light/dark and 390-pixel-wide layouts were inspected visually.

## Deployment checks still requiring service credentials

- No live TypeSafe Token was supplied. The documented protocol was checked against official sources, but real-model generation, model availability, browser CORS, latency, and billing were not accepted as verified behavior.
- No live Upstash Redis database was supplied. The shared quota algorithm was tested, but Redis connectivity, service-side behavior, and simultaneous requests across deployed instances still require an integration check in the target environment.
- Docker was not installed in the verification environment. The Dockerfile supplies a standalone, non-root runtime, but an actual container build and container startup were not run.

Public mode remains disabled by default. Configure the services and trusted proxy described in [deployment.md](deployment.md) before opening administrator-funded access.
