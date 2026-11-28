import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RilClient, RilError } from "../src/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bin = [
  process.env.RIL_BIN,
  join(root, "ril-core/target/debug/ril"),
  join(root, "ril-core/target/release/ril"),
].find((p) => p && existsSync(p));
const skip = bin ? false : "ril binary not built (cargo build --manifest-path ril-core/Cargo.toml)";
const ril = bin ? new RilClient({ bin }) : null;
const settlement = join(root, "examples/settlement.ril");
const quorum = join(root, "packs/quorum-settlement.ril");

test("check passes examples/settlement.ril with structured results", { skip }, () => {
  const r = ril.check(settlement);
  assert.equal(r.ok, true, JSON.stringify(r.raw));
  assert.equal(r.name, "Retvest Payment Settlement");
  assert.match(r.digest, /^[0-9a-f]{64}$/);
  assert.ok(r.machines.length >= 1 && r.machines[0].states_explored > 0);
  assert.ok(r.proofs.length >= 1);
  assert.deepEqual(r.diagnostics, []);
});

test("check passes packs/quorum-settlement.ril", { skip }, () => {
  const r = ril.check(quorum);
  assert.equal(r.ok, true, JSON.stringify(r.raw));
  assert.equal(r.machines[0].id, "quorum-settlement");
});

test("test runs inline tests", { skip }, () => {
  const r = ril.test(settlement);
  assert.equal(r.ok, true);
  assert.equal(r.passed, r.tests.length);
  assert.ok(r.tests.some((t) => t.verdict === "deny"));
});

test("broken file yields ok=false with structured diagnostics", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ril-ts-"));
  try {
    const bad = join(dir, "broken.ril");
    writeFileSync(bad, "law x {\n");
    const r = ril.check(bad);
    assert.equal(r.ok, false);
    assert.equal(r.diagnostics.length, 1);
    const d = r.diagnostics[0];
    assert.equal(d.kind, "parse");
    assert.equal(d.line, 1);
    assert.equal(typeof d.column, "number");
    assert.match(d.message, /expected/);
    assert.equal(ril.test(bad).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing file is a structured io diagnostic", { skip }, () => {
  const r = ril.check("/nonexistent/nope.ril");
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].kind, "io");
});

test("codegen returns code for ts and rust, and writes outPath", { skip }, () => {
  const ts = ril.codegen(settlement, "ts");
  assert.ok(ts.length > 0);
  assert.ok(ril.codegen(settlement, "rust").length > 0);
  const dir = mkdtempSync(join(tmpdir(), "ril-ts-"));
  try {
    const out = join(dir, "guards.ts");
    assert.equal(ril.codegen(settlement, "ts", out), ts);
    assert.equal(readFileSync(out, "utf8"), ts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codegen on a broken file throws RilError", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ril-ts-"));
  try {
    const bad = join(dir, "broken.ril");
    writeFileSync(bad, "nonsense\n");
    assert.throws(() => ril.codegen(bad, "ts"), RilError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("spec returns the grammar", { skip }, () => {
  assert.match(ril.spec(), /RIL v3 Language Grammar/);
});

test("verifyReceipt rejects a bogus receipt without throwing", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ril-ts-"));
  try {
    const receipt = join(dir, "r.json");
    writeFileSync(receipt, "{}");
    const r = ril.verifyReceipt(receipt, "00".repeat(32));
    assert.equal(r.ok, false);
    assert.equal(typeof r.output, "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Signed by `ril-core/examples/receipt_fixture.rs` (fixed test-only seed): 2 rows of action a1.
const fixtures = join(root, "sdks/fixtures");
const receiptFixture = join(fixtures, "receipt.json");
const pubPem = readFileSync(join(fixtures, "seal.pub.pem"), "utf8");
const pubHex = Buffer.from(pubPem.replace(/-----[^-]+-----|\s/g, ""), "base64").subarray(-32).toString("hex");

test("verifyReceipt accepts a real signed receipt (hex, PEM text and PEM path keys)", { skip }, () => {
  for (const key of [pubHex, pubPem, join(fixtures, "seal.pub.pem")]) {
    const r = ril.verifyReceipt(receiptFixture, key);
    assert.equal(r.ok, true, r.output);
    assert.match(r.output, /receipt verified: 2 rows of action a1 \(tenant acme\)/);
  }
});

test("verifyReceipt flips to not ok when one byte of the receipt changes", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ril-ts-"));
  try {
    const original = readFileSync(receiptFixture, "utf8");
    assert.ok(original.includes("10:00:01"));
    const tampered = join(dir, "tampered.json");
    writeFileSync(tampered, original.replace("10:00:01", "10:00:02"));
    const r = ril.verifyReceipt(tampered, pubHex);
    assert.equal(r.ok, false, r.output);
    assert.match(r.output, /NOT verified/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyReceipt rejects a valid receipt under a different key", { skip }, () => {
  const r = ril.verifyReceipt(receiptFixture, "11".repeat(32));
  assert.equal(r.ok, false, r.output);
});

test("missing binary raises RilError", () => {
  assert.throws(() => new RilClient({ bin: "/nonexistent/ril" }).spec(), RilError);
});
