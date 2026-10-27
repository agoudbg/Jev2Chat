# Deployment and security boundaries

## Transport modes

**Browser-direct BYOK:** requests go to the configured TypeSafe-compatible origin from the browser. Authentication and CORS must both be supported by that origin. The Token is accessible to the browser environment. No backend origin allowlist or application proxy quota applies to these upstream calls.

**Backend-proxy BYOK:** the browser sends its Token with that individual same-origin POST. The server constructs the authenticated upstream request and does not store the Token. Response projections contain known protocol fields only; credential values are redacted from reflected strings and errors. Proxy requests accept only exact operator-allowed origins, use HTTPS by default, refuse redirects, bound request and response bytes, and enforce timeouts. Adding an origin is an operator trust decision, including its DNS and network destinations. Do not allow arbitrary user-controlled origins or wildcard internal networks.

BYOK proxy protection is a process-local 120-request/60-second bucket with eight concurrent requests per client bucket and a 2,000-bucket bound. It is not a distributed public-service budget. Apply an edge request/body/concurrency policy for BYOK endpoints on an Internet deployment. Without trusted proxy configuration, all users share its bucket.

**Public mode:** the server uses its environment Token. A shared Redis store performs atomic run, frequency, concurrency, attempt and global daily admission. Missing shared storage fails closed, and there is no in-memory fallback. Public requests cannot override the model, upstream origin, paths or authentication. A stale client model receives a refresh-required error.

All mutation routes require an Origin matching the request protocol and Host authority, plus JSON content type. The Host check preserves the browser target when Next.js normalizes loopback addresses or a standalone server uses an internal hostname. X-Forwarded-Host is not used for this check. The application does not enable permissive CORS. These controls do not authenticate public visitors; public access remains public and requires quotas and edge protection.

## Enable public access

Use one Upstash Redis REST database shared by **every instance of this deployment**. A different deployment should use a separate database because quota keys use a common `jev:` prefix. Provide these runtime environment variables:

```dotenv
JEV_PUBLIC_ENABLED=true
JEV_PUBLIC_TOKEN=<server-only-typesafe-token>
JEV_PUBLIC_MODEL=jev-latest
JEV_PUBLIC_BASE_URL=https://api.typesafe.ai
JEV_ALLOWED_API_ORIGINS=https://api.typesafe.ai
UPSTASH_REDIS_REST_URL=https://<your-database>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<server-only-redis-token>
JEV_LIMITER_SECRET=<independent-random-secret-at-least-32-characters>
```

Use a cryptographically random secret, for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Generate a different secret for the trusted proxy. Keep environment files out of source control and out of container build contexts. `.env.example` contains no real secrets.

Set `JEV_PUBLIC_ENABLED=false` and restart/redeploy every instance to disable new public runs and requests. Requests already admitted upstream may finish or be billed. Removing an upstream Token is also a provider-side action; a UI stop cannot promise to reverse a charge already incurred.

| Variable                     | Default  | Enforcement                                             |
| ---------------------------- | -------- | ------------------------------------------------------- |
| `JEV_PUBLIC_MAX_ROUNDS`      | `64`     | Maximum rounds per server-issued run                    |
| `JEV_PUBLIC_MAX_RETRIES`     | `1`      | Maximum additional attempts per round                   |
| `JEV_PUBLIC_MAX_INPUT_CHARS` | `16000`  | Prompt plus current State, Unicode code points          |
| `JEV_BODY_MAX_BYTES`         | `262144` | Actual streamed bytes, even without Content-Length      |
| `JEV_UPSTREAM_TIMEOUT_MS`    | `30000`  | Upstream timeout, maximum allowed setting 60000         |
| `JEV_RATE_WINDOW_SECONDS`    | `60`     | Frequency window                                        |
| `JEV_RATE_REQUESTS`          | `30`     | Admitted Choice attempts per IP bucket/window           |
| `JEV_RUNS_PER_WINDOW`        | `5`      | New public runs per IP bucket/window                    |
| `JEV_IP_CONCURRENCY`         | `1`      | In-flight Choice attempts per IP bucket                 |
| `JEV_GLOBAL_CONCURRENCY`     | `8`      | In-flight Choice attempts across all instances          |
| `JEV_GLOBAL_DAILY_REQUESTS`  | `1000`   | Admitted attempts per UTC calendar day, deployment-wide |

The daily limit counts requests, **not currency or model tokens**. Set provider billing limits separately if available. Attempts consume quota when admitted, including upstream failures. Run creation and connection tests have separate frequency controls; models tests do not spend the daily Choice budget. Global concurrency protects model requests; also rate-limit all API paths at the edge to protect Redis and the application before admission.

Client editing, resuming or restarting may create another public run; per-IP creation, frequency and global quotas still apply. A run expires after one hour. Concurrency leases expire after the configured upstream timeout plus ten seconds to recover from terminated workers.

## Identify client IPs safely

The default `JEV_IP_MODE=shared` ignores all forwarded IP headers. Every visitor shares one frequency and concurrency bucket. This safe fallback is suitable for private experiments but does not provide distinct per-IP fairness.

For per-IP enforcement, deploy a trusted edge/reverse proxy and set:

```dotenv
JEV_IP_MODE=trusted-proxy
JEV_CLIENT_IP_HEADER=x-real-ip
JEV_TRUSTED_PROXY_SECRET=<another-independent-random-secret-at-least-32-characters>
```

The edge must replace client-supplied IP and secret headers, inject a **single validated IP**, and restrict direct access to the application origin. The backend rejects a missing/wrong proxy secret and does not parse arbitrary X-Forwarded-For chains. Public mode does not activate with an incomplete trusted-proxy setup.

Example Nginx location when Nginx receives visitors directly:

```nginx
location / {
    client_max_body_size 256k;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Jev-Proxy-Secret "<same-private-proxy-secret>";
    proxy_read_timeout 70s;
}
```

Terminate TLS at the edge. Add edge rate and connection limits appropriate to your infrastructure. If a CDN sits before Nginx, configure the real-IP module using that CDN's trusted address ranges; `$remote_addr` otherwise identifies the CDN. A platform that cannot inject protected headers can use shared mode, or place a trusted gateway in front of the app. Do not copy a generic client-controlled forwarding header into the trusted header.

IP addresses are HMAC-hashed before Redis key construction. The secret must be identical across instances. An attacker with rotating IPs can still obtain multiple buckets; global daily and concurrency limits constrain that risk. More demanding deployments can add a gateway challenge or authentication without changing the Choice adapter.

## Retries, cancellation and deduplication

By default, uncertain timeouts/network failures are not retried automatically. The UI's explicit opt-in warns that upstream work may already have completed and a retry may be billed again. Known overload/rate-limit errors can be retried within the configured attempt count. Every accepted choice is committed at most once locally, guarded by generation epoch and State revision.

Public mode stores a validated answer for a run/round and request hash. Retrying the same request returns that cached answer without another upstream call or quota charge. A different body for that round is rejected. Redis updates are atomic and concurrent workers cannot admit the same pending round twice. Redis stores the answer and its probabilities, a body hash, counters and leases for expiration; it does not store prompt/State bodies or either API Token. A provider that returns sensitive text in a known response field still has that field sanitized for credentials before caching.

There is no documented upstream idempotency key. An upstream result lost before it reaches the app cannot be recovered by local deduplication; an explicitly enabled retry may generate another upstream result. When Redis finalization fails, the request reports an uncertain outcome rather than pretending the answer was safely cached.

Stop cancels the browser fetch and prevents later rounds. Obsolete responses cannot overwrite an edited State. Network cancellation cannot guarantee that the upstream service has stopped processing or billing. Pausing allows the current response to finish and blocks subsequent requests, including retries.

## Logs, storage and hosting

Application audit output includes an event category, HTTP status and timestamp. It omits credentials, raw exceptions, prompt and State text. Do not enable request-body logging in a reverse proxy, APM collector or hosting integration for these endpoints. Hosting access logs and provider/Redis retention policies are outside the app's control.

Use HTTPS and a trusted application build. BYOK proxy mode still exposes the Token to the page that collects it, and to the app server during the request. It protects the public administrator Token from visitors; it does not make browser-stored BYOK credentials inaccessible to scripts or extensions. There is no server database of user Tokens.

Use Node.js hosting with outbound HTTPS access to TypeSafe and Upstash. Configure infrastructure timeouts with headroom above the app's upstream timeout. Development Mock is unavailable when `NODE_ENV=production`. The Dockerfile creates a non-root standalone runtime; Docker itself and a live Redis/TypeSafe deployment must be verified in your deployment environment.
