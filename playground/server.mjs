#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);

const MAX_BODY_SIZE = 256 * 1024; // 256 KB
const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 300000; // 5 minutes

// Security headers for all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
};

// In-memory rate limiter with periodic cleanup
class RateLimiter {
  constructor(maxRequests = DEFAULT_RATE_LIMIT_MAX, windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map(); // ip -> { count, windowStart }

    // Periodically prune stale entries to prevent memory leak
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.requests.entries()) {
        if (now - data.windowStart > this.windowMs) {
          this.requests.delete(ip);
        }
      }
    }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
  }

  check(ip) {
    const now = Date.now();
    const record = this.requests.get(ip);

    if (!record || now - record.windowStart > this.windowMs) {
      // New window
      this.requests.set(ip, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (record.count >= this.maxRequests) {
      const retryAfter = Math.ceil((record.windowStart + this.windowMs - now) / 1000);
      return { allowed: false, retryAfter };
    }

    record.count++;
    return { allowed: true };
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

const PRESETS = [
  {
    id: 'quorum-settlement',
    name: 'Quorum Settlement',
    description: 'Valid 2-of-3 quorum settlement machine with promises, laws, proofs, and tests',
    source: `ril "Enterprise Pack: Quorum Settlement" version 3

# A transfer is proposed, funds are reserved, two approvers sign off, and only then does it
# commit and settle. A breach after commit freezes the transfer for good.

machine quorum-settlement
  states Proposed, Quorate, Committed, Settled, Breached
  initial Proposed
  terminal Settled, Breached
  var approvals: int(0..3) = 0
  var reserved: bool = false
  var frozen: bool = false
  transition reserve: Proposed -> Proposed when !reserved && !frozen set reserved = true
  transition approve: Proposed -> Proposed when !frozen && approvals < 3 set approvals = approvals + 1
  transition reach_quorum: Proposed -> Quorate when !frozen && approvals >= 2 && reserved
  transition commit: Quorate -> Committed when !frozen
  transition settle: Committed -> Settled when !frozen
  transition breach: Committed -> Breached set frozen = true
  invariant quorum-before-commit: (state == Committed || state == Settled) => approvals >= 2
  invariant funds-reserved-before-commit: (state == Committed || state == Settled) => reserved
  invariant no-settle-when-frozen: state == Settled => !frozen
  invariant breach-freezes-the-transfer: state == Breached => frozen
  eventually reaches-terminal: state == Settled || state == Breached

promise settle-transfer
  says "Every admitted transfer settles within 30s without double-spend."
  why  "Financial actions must carry bounded, machine-checked obligations."
  for  "settle_transfer"
  requires "authorized", "funds_reserved", "quorum_reached"
  ensures  "ledger_balanced", "receipt_recorded"
  invariant "no_double_spend"
  within 30s
  on_breach freeze

law transfer-rbac
  says "Only an active treasurer may settle a transfer."
  why  "Settlement moves money; it is limited to the treasury role and never to suspended accounts."
  on action settle of Transfer
  permit when principal.role == "treasurer"
  forbid when principal.suspended == true
  forbid when resource.requester == principal.name

proof forbid-wins-over-permit
  proves "transfer-rbac"
  for_all permit: bool, ask: bool
  assert verdict(permit, ask, true) == deny

test treasurer-settles-a-small-transfer
  for "transfer-rbac"
  principal User::"tess" { role: "treasurer", suspended: false, name: "tess" }
  resource Transfer::"t-1" { requester: "sam", amount: 5000 }
  expect allow`
  },
  {
    id: 'broken-invariant',
    name: 'Broken Invariant (Counterexample Demo)',
    description: 'Deliberately broken settlement invariant to demonstrate counterexample traces',
    source: `ril "Broken Settlement (Counterexample Demo)" version 3

# This machine has a BROKEN invariant to demonstrate live model checking!
# The invariant claims you can't settle without approvals, but the machine allows it!

machine broken-settlement
  states Proposed, Committed, Settled
  initial Proposed
  terminal Settled
  var approvals: int(0..3) = 0
  transition commit: Proposed -> Committed
  transition settle: Committed -> Settled
  invariant broken-claim: state == Settled => approvals >= 2

# When you click "Check & Prove", TLC will find the SHORTEST counterexample:
# 1. Start in Proposed (approvals=0)
# 2. Transition via "commit" to Committed (approvals=0)
# 3. Transition via "settle" to Settled (approvals=0)
# 4. INVARIANT VIOLATED: (Settled => approvals >= 2) is FALSE!

proof this-will-fail
  proves "broken-claim"
  for_all approvals: int(0..3)
  assert (approvals >= 2) => true`
  },
  {
    id: 'pr-deploy-safety',
    name: 'PR & Deploy Safety',
    description: 'PR/deploy safety pack with agent workspace guards',
    source: `ril "Enterprise Pack: PR and Deploy Safety" version 3

# A pull request collects bounded approvals and passing checks, is merged, and only then deploys.
# A failed deploy freezes the release for good. Agents may not run destructive shell commands or
# write outside their workspace.

machine pr-deploy
  states Open, Approved, Merged, Deployed, Failed
  initial Open
  terminal Deployed, Failed
  var approvals: int(0..3) = 0
  var checks_passed: int(0..3) = 0
  var frozen: bool = false
  transition approve: Open -> Open when !frozen && approvals < 3 set approvals = approvals + 1
  transition pass_check: Open -> Open when !frozen && checks_passed < 3 set checks_passed = checks_passed + 1
  transition mark_ready: Open -> Approved when !frozen && approvals >= 2 && checks_passed >= 2
  transition merge: Approved -> Merged when !frozen
  transition deploy: Merged -> Deployed when !frozen
  transition fail_deploy: Merged -> Failed set frozen = true
  invariant approved-before-merge: (state == Merged || state == Deployed) => approvals >= 2
  invariant checks-before-merge: (state == Merged || state == Deployed) => checks_passed >= 2
  eventually reaches-terminal: state == Deployed || state == Failed

law workspace-write-guard
  says "Agents may write only inside their own workspace."
  why  "Keeps edits away from other repositories, credentials, and the host."
  on action Write of Tool
  permit when context has path && context.path like "/workspace/*"
  forbid when context has path && context.path like "*..*"
  forbid when context has path && context.path like "*.env*"

test write-inside-workspace-is-allowed
  for "workspace-write-guard"
  principal Agent::"a1" { name: "a1" }
  resource Tool::"Write" { name: "Write" }
  context { path: "/workspace/src/main.rs" }
  expect allow`
  },
  {
    id: 'pii-audit-access',
    name: 'PII Audit Access',
    description: 'PII access and audit pack with taint tracking and redaction',
    source: `ril "Enterprise Pack: PII Audit Access" version 3

# A request for personal data is justified, approved by two reviewers, granted, and read. Every
# read is audited before the case closes; a policy violation revokes access for good.

machine pii-access
  states Requested, Approved, Granted, Closed, Revoked
  initial Requested
  terminal Closed, Revoked
  var approvals: int(0..3) = 0
  var audited: bool = false
  var revoked: bool = false
  transition approve: Requested -> Requested when !revoked && approvals < 3 set approvals = approvals + 1
  transition authorize: Requested -> Approved when !revoked && approvals >= 2
  transition grant: Approved -> Granted when !revoked
  transition record_audit: Granted -> Granted when !audited set audited = true
  transition close: Granted -> Closed when !revoked && audited
  transition revoke: Granted -> Revoked set revoked = true
  invariant approved-before-grant: (state == Granted || state == Closed) => approvals >= 2
  invariant audited-before-close: state == Closed => audited
  eventually reaches-terminal: state == Closed || state == Revoked

law pii-access-rbac
  says "Only an active compliance officer may read PII, and never their own record."
  why  "Limits personal data to the audit role and prevents self-review."
  on action read of PersonalRecord
  permit when principal.role == "compliance"
  forbid when principal.suspended == true
  forbid when resource.subject == principal.name

test compliance-officer-reads-a-record
  for "pii-access-rbac"
  principal User::"cass" { role: "compliance", suspended: false, name: "cass" }
  resource PersonalRecord::"r-1" { subject: "sam", sensitivity: 1 }
  expect allow`
  },
  {
    id: 'cedar-sample',
    name: 'AWS Cedar Policy (Import Demo)',
    description: 'Sample AWS Cedar policy ready for 1-click import into RIL',
    source: `permit(
  principal,
  action == Action::"viewDocument",
  resource is Document
) when {
  principal.name == "alice"
};

forbid(
  principal,
  action == Action::"deleteDocument",
  resource is Document
) when {
  principal.name == "bob" && resource.critical == true
};`
  }
];

async function withTempFile(content, fn) {
  const tmpPath = join(tmpdir(), `ril-playground-${randomBytes(8).toString('hex')}`);
  try {
    await writeFile(tmpPath, content, 'utf8');
    return await fn(tmpPath);
  } finally {
    try {
      await unlink(tmpPath);
    } catch {}
  }
}

async function runRil(rilBin, args, input = null) {
  // Strict execution limits for public hosting
  const execOptions = {
    maxBuffer: 1024 * 1024, // 1 MB
    timeout: 5000 // 5 seconds
  };

  try {
    if (input !== null) {
      return await withTempFile(input, async (tmpPath) => {
        const { stdout, stderr } = await execFileAsync(rilBin, [...args, tmpPath], execOptions);
        return { ok: true, exitCode: 0, stdout, stderr };
      });
    } else {
      const { stdout, stderr } = await execFileAsync(rilBin, args, execOptions);
      return { ok: true, exitCode: 0, stdout, stderr };
    }
  } catch (err) {
    return {
      ok: false,
      exitCode: err.code || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message
    };
  }
}

function createPlaygroundServer({
  rilBin = process.env.RIL_BIN || 'ril',
  rateLimitMax = parseInt(process.env.RIL_RATE_LIMIT || DEFAULT_RATE_LIMIT_MAX, 10),
  rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS
} = {}) {
  const rateLimiter = new RateLimiter(rateLimitMax, rateLimitWindowMs);

  // Parse allowed hosts from env var (comma-separated)
  const allowedHostsEnv = process.env.RIL_ALLOWED_HOSTS || 'localhost,127.0.0.1';
  const allowedHosts = new Set(allowedHostsEnv.split(',').map(h => h.trim()).filter(h => h.length > 0));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Add security headers to all responses
    const writeWithHeaders = (statusCode, extraHeaders = {}) => {
      res.writeHead(statusCode, { ...SECURITY_HEADERS, ...extraHeaders });
    };

    // Validate Host header to prevent DNS rebinding attacks
    const host = req.headers.host;
    const hostWithoutPort = host ? host.split(':')[0] : '';

    if (!host || !allowedHosts.has(hostWithoutPort)) {
      writeWithHeaders(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid Host header' }));
      return;
    }

    // Rate limiting for /api/* endpoints
    if (url.pathname.startsWith('/api/')) {
      const clientIp = req.socket.remoteAddress || 'unknown';
      const rateLimitResult = rateLimiter.check(clientIp);

      if (!rateLimitResult.allowed) {
        writeWithHeaders(429, {
          'Content-Type': 'application/json',
          'Retry-After': rateLimitResult.retryAfter.toString()
        });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
        return;
      }
    }

    // GET /healthz - health check endpoint
    if (req.method === 'GET' && url.pathname === '/healthz') {
      writeWithHeaders(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'ril-playground', version: '0.3.0' }));
      return;
    }

    // GET / - serve index.html
    if (req.method === 'GET' && url.pathname === '/') {
      try {
        const html = await readFile(join(import.meta.dirname, 'index.html'), 'utf8');
        writeWithHeaders(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        writeWithHeaders(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/presets
    if (req.method === 'GET' && url.pathname === '/api/presets') {
      writeWithHeaders(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(PRESETS));
      return;
    }

    // POST endpoints
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          writeWithHeaders(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));

          // POST /api/check
          if (url.pathname === '/api/check') {
            const { source } = body;
            if (!source) {
              writeWithHeaders(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing source field' }));
              return;
            }

            const result = await runRil(rilBin, ['check', '--json'], source);
            writeWithHeaders(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: result.ok,
              exitCode: result.exitCode,
              result: result.stdout,
              stderr: result.stderr
            }));
            return;
          }

          // POST /api/codegen
          if (url.pathname === '/api/codegen') {
            const { source, lang } = body;
            if (!source || !lang) {
              writeWithHeaders(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing source or lang field' }));
              return;
            }
            if (!['rust', 'ts'].includes(lang)) {
              writeWithHeaders(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid lang (must be rust or ts)' }));
              return;
            }

            const result = await runRil(rilBin, ['codegen', '--lang', lang], source);
            writeWithHeaders(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: result.ok,
              code: result.stdout,
              stderr: result.stderr
            }));
            return;
          }

          // POST /api/import
          if (url.pathname === '/api/import') {
            const { from, source, name } = body;
            if (!from || !source) {
              writeWithHeaders(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing from or source field' }));
              return;
            }
            if (!['cedar', 'codeowners', 'mcp'].includes(from)) {
              writeWithHeaders(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid from (must be cedar, codeowners, or mcp)' }));
              return;
            }

            const args = ['import', '--from', from];
            if (name) args.push('--name', name);

            const result = await runRil(rilBin, args, source);
            writeWithHeaders(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: result.ok,
              ril: result.stdout,
              stderr: result.stderr
            }));
            return;
          }

          // POST /api/audit-pack
          if (url.pathname === '/api/audit-pack') {
            const { source, framework } = body;
            if (!source || !framework) {
              writeWithHeaders(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing source or framework field' }));
              return;
            }
            if (!['eu-ai-act', 'soc2', 'iso-42001', 'all'].includes(framework)) {
              writeWithHeaders(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid framework' }));
              return;
            }

            const tmpJsonPath = join(tmpdir(), `ril-audit-${randomBytes(8).toString('hex')}.json`);
            const tmpMdPath = join(tmpdir(), `ril-audit-${randomBytes(8).toString('hex')}.md`);

            try {
              const result = await withTempFile(source, async (tmpPath) => {
                const args = ['audit-pack', tmpPath, '--framework', framework, '--out', tmpJsonPath, '--markdown', tmpMdPath];
                const execResult = await runRil(rilBin, args, null);

                if (execResult.ok) {
                  const bundle = await readFile(tmpJsonPath, 'utf8');
                  const markdown = await readFile(tmpMdPath, 'utf8');
                  return { ok: true, bundle, markdown, stderr: execResult.stderr };
                } else {
                  return { ok: false, bundle: null, markdown: null, stderr: execResult.stderr };
                }
              });

              writeWithHeaders(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } finally {
              try { await unlink(tmpJsonPath); } catch {}
              try { await unlink(tmpMdPath); } catch {}
            }
            return;
          }

          writeWithHeaders(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        } catch (err) {
          writeWithHeaders(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      req.on('error', () => {
        writeWithHeaders(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request error' }));
      });

      return;
    }

    writeWithHeaders(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  // Cleanup rate limiter when server closes
  server.on('close', () => {
    rateLimiter.destroy();
  });

  return server;
}

// Standalone mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '8787', 10);
  const host = process.env.HOST || '127.0.0.1';
  const server = createPlaygroundServer();
  server.listen(port, host, () => {
    console.log(`🎮 RIL Interactive Playground running at http://${host}:${port}`);
    console.log(`   Using RIL binary: ${process.env.RIL_BIN || 'ril'}`);
    console.log(`   Rate limit: ${process.env.RIL_RATE_LIMIT || DEFAULT_RATE_LIMIT_MAX} requests per 60s`);
    console.log(`   Allowed hosts: ${process.env.RIL_ALLOWED_HOSTS || 'localhost,127.0.0.1'}`);
  });
}

export { createPlaygroundServer };
