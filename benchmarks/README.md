# RIL Reproducible Benchmark Suite

Zero-dependency Node.js benchmark runner for RIL core operations.

## Usage

```sh
# Run with default binary (ril-core/target/release/ril):
node benchmarks/bench.mjs

# Run with custom binary:
RIL_BIN=/usr/local/bin/ril node benchmarks/bench.mjs
```

## What It Measures

Each benchmark runs 30 iterations (after 3 warmup runs) and reports median + p95 latency:

1. **`ril check examples/settlement.ril`** — Full parse + model checker + prover + inline tests
2. **`ril check packs/quorum-settlement.ril`** — Enterprise pack verification
3. **`ril codegen examples/settlement.ril --lang rust`** — Rust code generation
4. **`ril audit-pack examples/settlement.ril`** — Compliance audit (SOC2/ISO/GDPR/HIPAA)

## Hardware Metadata

The suite prints exact hardware metadata before each run:
- OS platform (`darwin`, `linux`, `win32`)
- Architecture (`x64`, `arm64`)
- CPU model
- RIL binary path
- Binary size in MB

## Example Output

```
RIL Reproducible Benchmark Suite
=================================

Platform:     darwin-arm64
CPU:          Apple M2 Max
Binary:       /path/to/ril-core/target/release/ril
Binary size:  17.2 MB
Iterations:   30 (3 warmup)

Results:
--------
ril check examples/settlement.ril                  median:    4.2ms  p95:    5.1ms
ril check packs/quorum-settlement.ril              median:    8.7ms  p95:   10.3ms
ril codegen examples/settlement.ril --lang rust    median:    6.1ms  p95:    7.4ms
ril audit-pack examples/settlement.ril             median:   12.5ms  p95:   15.2ms

✓ Benchmark suite completed successfully.
```

## Contributing Benchmarks

To add a new benchmark, edit `bench.mjs` and add a new entry to the `results` array:

```javascript
runBench(
  "Description of benchmark",
  `${RIL_BIN} your-command-here`
),
```

Keep benchmarks focused on core RIL operations that users will run frequently.
