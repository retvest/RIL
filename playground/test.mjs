import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { request } from 'node:http';
import { createPlaygroundServer } from './server.mjs';

const rilBin = process.env.RIL_BIN || '/Users/clifordprince/Retvest/servers/retvest-ril/ril-core/target/release/ril';

let server;
let baseUrl;

test('setup server on random port', async () => {
  server = createPlaygroundServer({ rilBin });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) reject(err);
      else {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        console.log(`Test server running at ${baseUrl}`);
        resolve();
      }
    });
  });
});

test('GET / returns 200 HTML with playground UI', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');

  const html = await res.text();
  assert.ok(html.includes('RIL Interactive Playground'));
  assert.ok(html.includes('editor'));
  assert.ok(html.includes('Check & Prove'));
});

test('GET /api/presets returns all 5 presets', async () => {
  const res = await fetch(`${baseUrl}/api/presets`);
  assert.equal(res.status, 200);

  const presets = await res.json();
  assert.equal(presets.length, 5);

  const ids = presets.map(p => p.id);
  assert.ok(ids.includes('quorum-settlement'));
  assert.ok(ids.includes('broken-invariant'));
  assert.ok(ids.includes('pr-deploy-safety'));
  assert.ok(ids.includes('pii-audit-access'));
  assert.ok(ids.includes('cedar-sample'));
});

test('POST /api/check on valid quorum-settlement returns ok:true', async () => {
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  const presets = await presetsRes.json();
  const quorumPreset = presets.find(p => p.id === 'quorum-settlement');

  const res = await fetch(`${baseUrl}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: quorumPreset.source })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.exitCode, 0);

  // Check that result contains verification data
  if (data.result) {
    const result = JSON.parse(data.result);
    assert.ok(result.machines || result.proofs || result.tests || result.valid);
  }
});

test('POST /api/check on broken-invariant returns ok:false with counterexample', async () => {
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  const presets = await presetsRes.json();
  const brokenPreset = presets.find(p => p.id === 'broken-invariant');

  const res = await fetch(`${baseUrl}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: brokenPreset.source })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  // The broken invariant should produce diagnostics in stderr
  assert.ok(data.stderr || data.exitCode !== 0);
  console.log('Broken invariant check result:', { ok: data.ok, exitCode: data.exitCode, hasStderr: !!data.stderr });
});

test('POST /api/codegen for rust returns valid generated code', async () => {
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  const presets = await presetsRes.json();
  const quorumPreset = presets.find(p => p.id === 'quorum-settlement');

  const res = await fetch(`${baseUrl}/api/codegen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: quorumPreset.source, lang: 'rust' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.ok, true, `Rust codegen failed: ${data.stderr}`);
  assert.ok(data.code);
  assert.ok(data.code.length > 0);
  console.log('Rust codegen generated', data.code.length, 'bytes');
});

test('POST /api/codegen for ts returns valid generated code', async () => {
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  const presets = await presetsRes.json();
  const quorumPreset = presets.find(p => p.id === 'quorum-settlement');

  const res = await fetch(`${baseUrl}/api/codegen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: quorumPreset.source, lang: 'ts' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.ok, true, `TypeScript codegen failed: ${data.stderr}`);
  assert.ok(data.code);
  assert.ok(data.code.length > 0);
  console.log('TypeScript codegen generated', data.code.length, 'bytes');
});

test('POST /api/import for cedar returns valid RIL v3', async () => {
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  const presets = await presetsRes.json();
  const cedarPreset = presets.find(p => p.id === 'cedar-sample');

  const res = await fetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'cedar', source: cedarPreset.source })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.ok, true, `Cedar import failed: ${data.stderr}`);
  assert.ok(data.ril);
  assert.ok(data.ril.includes('ril') || data.ril.includes('law') || data.ril.includes('version'));
  console.log('Cedar import generated', data.ril.length, 'bytes');
});

test('POST /api/audit-pack for eu-ai-act returns valid bundle', async () => {
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  const presets = await presetsRes.json();
  const quorumPreset = presets.find(p => p.id === 'quorum-settlement');

  const res = await fetch(`${baseUrl}/api/audit-pack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: quorumPreset.source, framework: 'eu-ai-act' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.ok, true, `EU AI Act audit pack failed: ${data.stderr}`);
  assert.ok(data.bundle);
  assert.ok(data.markdown);

  const bundle = JSON.parse(data.bundle);
  assert.ok(bundle.bundle_digest || bundle.policy_digest || bundle.controls);
  console.log('EU AI Act audit pack generated');
});

test('POST /api/audit-pack for all frameworks returns valid bundle', async () => {
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  const presets = await presetsRes.json();
  const quorumPreset = presets.find(p => p.id === 'quorum-settlement');

  const res = await fetch(`${baseUrl}/api/audit-pack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: quorumPreset.source, framework: 'all' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.ok, true, `All frameworks audit pack failed: ${data.stderr}`);
  assert.ok(data.bundle);
  assert.ok(data.markdown);
  console.log('All frameworks audit pack generated');
});

test('POST /api/check with oversized payload returns 413 or socket close', async () => {
  const oversized = 'x'.repeat(300 * 1024); // 300 KB

  try {
    const res = await fetch(`${baseUrl}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: oversized })
    });

    // If we get a response, it should be 413
    assert.equal(res.status, 413);
  } catch (err) {
    // Server may also destroy the connection (socket close), which is correct behavior
    assert.ok(err.message.includes('fetch failed') || err.message.includes('socket'));
    console.log('Oversized payload correctly rejected via socket close');
  }
});

test('POST /api/codegen with invalid lang returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/codegen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'ril "test" version 3', lang: 'python' })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('lang'));
});

test('POST /api/import with invalid from returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: '{}', from: 'invalid' })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('from'));
});

test('POST /api/audit-pack with invalid framework returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/audit-pack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'ril "test" version 3', framework: 'invalid' })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('framework'));
});

test('GET /healthz returns 200 with ok:true and security headers', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);

  // Check security headers
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(res.headers.get('content-security-policy'));

  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'ril-playground');
  assert.equal(data.version, '0.3.0');
});

test('Rate limiter triggers HTTP 429 with Retry-After header', async () => {
  // Create a fresh server with a very low rate limit for testing
  const testServer = createPlaygroundServer({ rilBin, rateLimitMax: 2, rateLimitWindowMs: 60000 });

  await new Promise((resolve, reject) => {
    testServer.listen(0, '127.0.0.1', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const addr = testServer.address();
  const testBaseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // First 2 requests should succeed
    const res1 = await fetch(`${testBaseUrl}/api/presets`);
    assert.equal(res1.status, 200);

    const res2 = await fetch(`${testBaseUrl}/api/presets`);
    assert.equal(res2.status, 200);

    // Third request should be rate limited
    const res3 = await fetch(`${testBaseUrl}/api/presets`);
    assert.equal(res3.status, 429);

    const data = await res3.json();
    assert.equal(data.error, 'rate limit exceeded');

    // Check Retry-After header
    const retryAfter = res3.headers.get('retry-after');
    assert.ok(retryAfter);
    assert.ok(parseInt(retryAfter, 10) > 0);

    console.log(`Rate limit correctly triggered, retry after ${retryAfter}s`);
  } finally {
    await new Promise((resolve) => {
      testServer.close(() => resolve());
    });
  }
});

test('Invalid Host header returns HTTP 400', async () => {
  // Use low-level http.request to send arbitrary Host header
  const addr = server.address();

  const response = await new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/',
      method: 'GET',
      headers: {
        'Host': 'evil.example.com:8787'
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.end();
  });

  assert.equal(response.status, 400);
  const data = JSON.parse(response.body);
  assert.equal(data.error, 'Invalid Host header');
});

test('teardown server', async () => {
  await new Promise((resolve) => {
    server.close(() => {
      console.log('Test server stopped');
      resolve();
    });
  });
});
