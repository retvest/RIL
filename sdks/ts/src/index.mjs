// @retvest/ril — zero-dependency wrapper around the `ril` CLI.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class RilError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RilError";
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
    this.status = details.status ?? null;
  }
}

export { RilDeniedError, RilApprovalRequiredError, governTool, wrapTools } from "./agent.mjs";

// ASN.1 SubjectPublicKeyInfo prefix for a raw Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function asDiagnostics(raw) {
  return Array.isArray(raw.diagnostics) ? raw.diagnostics : [];
}

export class RilClient {
  constructor(opts = {}) {
    this.bin = opts.bin ?? process.env.RIL_BIN ?? "ril";
  }

  #run(args) {
    const r = spawnSync(this.bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new RilError(`cannot run \`${this.bin}\`: ${r.error.message}`, { status: null });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  // Exit code 1 with a JSON body is a normal verification failure, not an exception.
  #runJson(cmd, filePath) {
    const r = this.#run([cmd, filePath, "--json"]);
    let raw;
    try {
      raw = JSON.parse(r.stdout);
    } catch {
      throw new RilError(`ril ${cmd}: no JSON on stdout (exit ${r.status}): ${r.stderr || r.stdout}`, r);
    }
    return raw;
  }

  check(filePath) {
    const raw = this.#runJson("check", filePath);
    return {
      ok: raw.ok === true,
      name: raw.name,
      version: raw.version,
      digest: raw.digest,
      laws: raw.laws,
      promises: raw.promises,
      machines: raw.machines ?? [],
      proofs: raw.proofs ?? [],
      tests: raw.tests ?? [],
      diagnostics: asDiagnostics(raw),
      raw,
    };
  }

  test(filePath) {
    const raw = this.#runJson("test", filePath);
    return {
      ok: raw.ok === true,
      passed: raw.passed ?? 0,
      tests: raw.tests ?? [],
      diagnostics: asDiagnostics(raw),
      raw,
    };
  }

  codegen(filePath, lang, outPath) {
    const args = ["codegen", filePath, "--lang", lang];
    if (outPath) args.push("--out", outPath);
    const r = this.#run(args);
    if (r.status !== 0) throw new RilError(`ril codegen failed: ${r.stderr.trim()}`, r);
    return outPath ? readFileSync(outPath, "utf8") : r.stdout;
  }

  spec() {
    const r = this.#run(["spec"]);
    if (r.status !== 0) throw new RilError(`ril spec failed: ${r.stderr.trim()}`, r);
    return r.stdout;
  }

  verifyReceipt(receiptPath, publicKeyHex) {
    let dir;
    let keyPath = publicKeyHex;
    try {
      const key = String(publicKeyHex).trim();
      if (/^[0-9a-fA-F]{64}$/.test(key)) {
        const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key, "hex")]);
        const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString("base64")}\n-----END PUBLIC KEY-----\n`;
        dir = mkdtempSync(join(tmpdir(), "ril-sdk-"));
        keyPath = join(dir, "seal.pub.pem");
        writeFileSync(keyPath, pem, { mode: 0o600 });
      } else if (key.includes("BEGIN PUBLIC KEY")) {
        dir = mkdtempSync(join(tmpdir(), "ril-sdk-"));
        keyPath = join(dir, "seal.pub.pem");
        writeFileSync(keyPath, key + "\n", { mode: 0o600 });
      } else if (!existsSync(key)) {
        throw new RilError("publicKeyHex must be 64 hex chars, PEM text, or a PEM file path");
      }
      const r = this.#run(["verify-receipt", receiptPath, "--public-key", keyPath]);
      return { ok: r.status === 0, output: (r.stdout + r.stderr).trim() };
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }

  evaluate(lawFile, action, opts = {}) {
    const { actor = "Agent:ai", resource = "Resource:default", context = {}, entities = [] } = opts;
    const args = ["laws", "eval", lawFile, "--action", action, "--resource", resource, "--principal", actor];

    if (typeof context === "object" && context !== null) {
      args.push("--context", JSON.stringify(context));
    }

    for (const entity of entities) {
      args.push("--entity", entity);
    }

    args.push("--json");

    const r = this.#run(args);
    let raw;
    try {
      raw = JSON.parse(r.stdout);
    } catch {
      throw new RilError(`ril laws eval: no JSON on stdout (exit ${r.status}): ${r.stderr || r.stdout}`, r);
    }

    return {
      verdict: raw.verdict,
      laws: raw.laws || [],
      errors: raw.errors || {},
      lawSetDigest: raw.law_set_digest,
      raw,
    };
  }
}
