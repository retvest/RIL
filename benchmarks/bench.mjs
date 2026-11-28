#!/usr/bin/env node
/**
 * RIL Reproducible Benchmark Suite
 * Zero external dependencies — pure Node.js ESM.
 * Run: node benchmarks/bench.mjs
 */

import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { platform, arch, cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

const RIL_BIN = process.env.RIL_BIN || join(ROOT, "ril-core/target/release/ril");

function formatDuration(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function p95(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[idx];
}

function runBench(label, cmd, iterations = 30) {
  const timings = [];

  // Warmup
  for (let i = 0; i < 3; i++) {
    execSync(cmd, { cwd: ROOT, stdio: "ignore" });
  }

  // Measure
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    execSync(cmd, { cwd: ROOT, stdio: "ignore" });
    timings.push(performance.now() - start);
  }

  return { label, median: median(timings), p95: p95(timings) };
}

function main() {
  console.log("RIL Reproducible Benchmark Suite");
  console.log("=================================\n");

  // Hardware metadata
  const cpuModel = cpus()[0]?.model || "unknown";
  const binSize = statSync(RIL_BIN).size;

  console.log(`Platform:     ${platform()}-${arch()}`);
  console.log(`CPU:          ${cpuModel}`);
  console.log(`Binary:       ${RIL_BIN}`);
  console.log(`Binary size:  ${formatBytes(binSize)}`);
  console.log(`Iterations:   30 (3 warmup)`);
  console.log();

  // Benchmarks
  const results = [
    runBench(
      "ril check examples/settlement.ril",
      `${RIL_BIN} check examples/settlement.ril`
    ),
    runBench(
      "ril check packs/quorum-settlement.ril",
      `${RIL_BIN} check packs/quorum-settlement.ril`
    ),
    runBench(
      "ril codegen examples/settlement.ril --lang rust",
      `${RIL_BIN} codegen examples/settlement.ril --lang rust`
    ),
    runBench(
      "ril audit-pack examples/settlement.ril",
      `${RIL_BIN} audit-pack examples/settlement.ril --framework all`
    ),
  ];

  console.log("Results:");
  console.log("--------");
  const maxLabelLen = Math.max(...results.map((r) => r.label.length));
  for (const result of results) {
    const label = result.label.padEnd(maxLabelLen);
    console.log(`${label}  median: ${formatDuration(result.median).padStart(8)}  p95: ${formatDuration(result.p95).padStart(8)}`);
  }

  console.log("\n✓ Benchmark suite completed successfully.");
}

main();
