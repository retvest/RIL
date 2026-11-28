# RIL Interactive Playground

**Production-hardened, zero-dependency interactive playground** for writing RIL v3 policies with live formal model checking, proof verification, counterexample traces, state machine codegen, AWS Cedar/CODEOWNERS/MCP import, and EU AI Act/SOC 2/ISO 42001 audit pack generation — all powered by the real `ril` binary!

**Ready for public hosting** with per-IP rate limiting, strict execution timeouts, security headers, and Docker deployment!

## 🚀 Quick Start

### Local Development

```bash
# Start the playground server
node playground/server.mjs

# Open in your browser
open http://127.0.0.1:8787
```

The server binds to `127.0.0.1:8787` by default. Configure with environment variables:

```bash
# Change port
PORT=3000 node playground/server.mjs

# Allow additional hosts (for production deployment)
RIL_ALLOWED_HOSTS=localhost,127.0.0.1,play.ril-lang.org node playground/server.mjs

# Set custom rate limit (default: 30 requests per 60 seconds)
RIL_RATE_LIMIT=100 node playground/server.mjs
```

### Docker Deployment (Production)

Build and run the playground in Docker with 1 command:

```bash
# Build the image (from repository root)
cd /Users/clifordprince/Retvest/servers/retvest-ril
docker build -f playground/Dockerfile -t ril-playground .

# Run the container
docker run -p 8787:8787 \
  -e RIL_ALLOWED_HOSTS=localhost,127.0.0.1,play.ril-lang.org \
  -e RIL_RATE_LIMIT=100 \
  ril-playground

# Open in your browser
open http://127.0.0.1:8787
```

The Docker image includes:
- Multi-stage build (Rust compilation + Node runtime)
- Non-root user (`ril`)
- Health check endpoint (`/healthz`)
- Strict security headers
- Per-IP rate limiting
- 5-second execution timeout
- 1 MB max buffer size

## 🧪 Run Tests

Run all 15 tests against the real `ril` binary (no browser windows):

```bash
# Use the default RIL_BIN path
node --test playground/test.mjs

# Or specify a custom ril binary
RIL_BIN=/path/to/ril node --test playground/test.mjs
```

## ✨ Features

### 📝 Interactive Code Editor
- Line numbers and syntax-aware editing
- Keyboard shortcuts (`Cmd/Ctrl+Enter` to Check & Prove)
- 5 curated presets including a **deliberately broken invariant** to demonstrate live counterexample traces!

### 🔍 Check & Prove
- Run `ril check --json` on your code
- Visual pass/fail cards for machines, invariants, proofs, laws, promises, and tests
- **Shortest counterexample traces** when proofs or invariants fail (try the "Broken Invariant" preset!)

### 🔧 Code Generation
- **Generate Rust**: Typed state machines with enums, transitions, and guards
- **Generate TypeScript**: Typed state machines with types, transitions, and guards
- 1-click copy to clipboard

### 📋 Audit Packs
- Select framework: **EU AI Act**, **SOC 2**, **ISO 42001**, or **All**
- Generates compliance control matrix with bundle/policy SHA-256 digests
- Download as Markdown or JSON

### 📥 Import from External Formats
- **AWS Cedar** policies → RIL v3 laws with generated tests
- **CODEOWNERS** → RIL v3 access control laws
- **MCP configs** → RIL v3 tool safety laws
- 1-click "Load into Editor"

## 📦 Curated Presets

1. **Quorum Settlement** — Valid 2-of-3 quorum settlement machine with promises, laws, proofs, and tests
2. **Broken Invariant** — Deliberately broken settlement invariant to demonstrate counterexample traces
3. **PR & Deploy Safety** — PR/deploy safety pack with agent workspace guards
4. **PII Audit Access** — PII access and audit pack with taint tracking and redaction
5. **Cedar Sample** — Sample AWS Cedar policy ready for 1-click import into RIL

## 🛡️ Security (Production-Hardened)

- **Rate Limiting**: Per-IP rate limiter (default: 30 requests per 60s) with automatic stale entry cleanup
- **Execution Limits**: Strict 5-second timeout and 1 MB max buffer on all `ril` executions
- **Security Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy`
- **Host Validation**: DNS rebinding protection with configurable allowed hosts
- **Request Size Limit**: 256 KB max body size with connection destruction on overflow
- **Command Injection Protection**: Uses `execFile` (never shell `exec`)
- **Temp File Safety**: Automatic cleanup with random filenames
- **Zero External Dependencies**: Node built-ins only, works 100% offline
- **Non-Root Execution**: Docker container runs as unprivileged `ril` user
- **Health Check**: `/healthz` endpoint for load balancer probes

## 📐 Architecture

- `server.mjs` — Node.js HTTP server with `/api/check`, `/api/codegen`, `/api/import`, `/api/audit-pack`, `/api/presets`
- `index.html` — Self-contained dark-mode developer studio UI with vanilla JavaScript
- `test.mjs` — Node built-in test runner with 15 comprehensive tests

## 🧑‍💻 Developer Mode

Export the server for programmatic use with custom options:

```javascript
import { createPlaygroundServer } from './playground/server.mjs';

const server = createPlaygroundServer({
  rilBin: '/path/to/ril',           // Custom RIL binary path
  rateLimitMax: 100,                 // Max requests per window (default: 30)
  rateLimitWindowMs: 60000           // Window size in ms (default: 60000)
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  console.log(`Playground at http://127.0.0.1:${addr.port}`);
});
```

Environment variables override defaults:
- `RIL_BIN`: Path to `ril` binary
- `RIL_RATE_LIMIT`: Max requests per 60-second window
- `RIL_ALLOWED_HOSTS`: Comma-separated list of allowed hostnames
- `HOST`: Bind address (default: `127.0.0.1`, use `0.0.0.0` in Docker)
- `PORT`: Server port (default: `8787`)

## 🎯 Test Coverage

All 18 tests run against the **real `ril` binary** (no mocks):

1. `GET /` returns 200 HTML with playground UI
2. `GET /api/presets` returns all 5 presets
3. `POST /api/check` on valid `quorum-settlement` returns `ok: true`
4. `POST /api/check` on `broken-invariant` returns `ok: false` with counterexample
5. `POST /api/codegen` for `rust` returns valid generated code
6. `POST /api/codegen` for `ts` returns valid generated code
7. `POST /api/import` for `cedar` returns valid RIL v3 with tests
8. `POST /api/audit-pack` for `eu-ai-act` returns valid bundle
9. `POST /api/audit-pack` for `all` returns valid bundle
10. Oversized payload (> 256 KB) returns HTTP 413
11. Invalid `lang` returns HTTP 400
12. Invalid `from` returns HTTP 400
13. Invalid `framework` returns HTTP 400
14. **`GET /healthz` returns 200 with `ok: true` and security headers**
15. **Rate limiter triggers HTTP 429 with `Retry-After` header**
16. **Invalid `Host` header returns HTTP 400**
17. Server setup on random port
18. Server teardown

## 🌐 Browser Compatibility

Works in all modern browsers (Chrome, Firefox, Safari, Edge). No build step required!

## 📄 License

Same as the parent RIL project.
