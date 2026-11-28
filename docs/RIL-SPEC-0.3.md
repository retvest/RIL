# RIL Specification 0.3 — Language, Verification, and Receipt Standard

**Status:** Draft 0.3 (Implementable Reference Specification)  
**Canonical Conformance Suite:** `conformance/001-*.json` .. `conformance/011-*.json`

## 1. Purpose
RIL is an open, neutral, fail-closed language and control plane for proving and governing what AI
systems do. Any conforming implementation MUST pass every vector in `conformance/` and produce
identical canonical RFC 8785 digests, verdicts, and verification failures.

## 2. File Structure & Canonical Digest (§8)
A `.ril` file is UTF-8 (at most 1 MiB) beginning with:
```ril
ril "<Name>" version <WholeNumber>
```
(`laws "<Name>" version <WholeNumber>` is accepted as a backwards-compatible alias.)

Top-level blocks may appear in any order:
1. `machine <id>` — Finite-state protocol with `states`, `initial`, `terminal`, typed `var` (`bool` or `int(lo..hi)`), guarded `transition` rules, safety `invariant`s, and `eventually` liveness properties.
2. `promise <id>` — Bounded temporal obligation (`for`, `requires`, `ensures`, `invariant`, `within`, `on_breach ask|deny|freeze`).
3. `law <id>` — Governance rule (`on action`, `on budget`, `on data`, `on cluster`, `on sequence`, `on code`).
4. `proof <id>` — Quantified algebraic proof obligation (`proves`, optional `for_all`, `assert`).
5. `test <id>` — Executable inline test case (`for`, `principal`, `resource`, optional `context`, `expect allow|hold|deny`).

The canonical form sorts `laws`, `proofs`, `tests`, and `machines` by `id`, serializes via RFC 8785
(JCS), and hashes with SHA-256. Reordering blocks or comments MUST NOT change the digest.

## 3. Verdict Algebra (§5)
Every action decision produces `allow`, `hold`, or `deny` under strict precedence:
1. **Forbid dominates:** Any matching or erroring `forbid` forces `deny`.
2. **Ask beats permit:** Otherwise, any matching or erroring `ask` forces `hold`.
3. **Permit requires clean match:** Otherwise, any non-erroring matching `permit` produces `allow`.
4. **Default deny:** Otherwise `deny`.

All decision engines (reference evaluator, compiled Cedar engine, and parallel `fast_eval`) MUST
produce identical verdicts, deciding law IDs, and error maps.

## 4. State-Machine Verification Semantics
A conforming `machine` verifier MUST exhaustively explore all reachable `(state, vars)` states and:
- Reject any reachable state violating an `invariant` with a step-by-step counterexample trace.
- Reject any `terminal` state with an outgoing transition.
- Reject any non-terminal reachable state with zero enabled transitions (deadlock) when terminals are declared.
- Reject any `int(lo..hi)` update outside `[lo, hi]`.
- For every `eventually` property `P`, verify that every reachable state has a finite path to a state satisfying `P`.

## 5. Non-Weakening Evolution Gate
`ril laws diff <base> <head>` MUST exit non-zero if `head` deletes a law, adds a new `permit`,
broadens `allow_models`, loosens a `budget` cap or `promise` deadline, removes a `requires`/`ensures`/
`invariant` clause, or downgrades `on_breach` (`freeze > deny > ask`).

## 6. Offline Cryptographic Receipts
Every governed action recorded by `ril serve` / `ril hook` / `ril mcp-gateway` binds:
`tenant`, `action_id`, `principal`, `agent`, `model_claims`, `decision`, `deciding_laws`,
`approval_preview_digest`, `effect`, and `outcome` (`done | denied | failed | unknown | reconciled`)
into an append-only Merkle hash chain signed with Ed25519, verifiable offline via `ril verify-receipt`.
