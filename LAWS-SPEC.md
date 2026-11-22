# RIL Laws — draft specification 0.1

Draft 0.1, 18 November 2026, with normative owner decisions through 22 November 2026 (§13, §15 to §20). Built in `ril-core` (`src/laws/`): the parser and structural checks, the canonical form and digest, the reference evaluator, the Cedar compiler, live request mapping, entity reads and the merge gate record. The conformance suite (§9.6) is in `conformance/`. It follows the owner's
decision of 18 November (MASTER-PLAN.md lane 26): RIL gets a small **rules language** for what AI may
do, aimed at an open industry standard, with Bend (bend-lang.com) as a reference for the idea that
AI cannot ship what breaks a law. It extends [DESIGN.md](DESIGN.md) and obeys [LESSONS.md](LESSONS.md).

## 1. The idea in one paragraph

A company writes its **laws** once, in short plain files. Every AI must obey them in two places:
when it **takes an action** (RIL checks the law at the tool-call boundary, as it already does with
Cedar) and when it **writes code** (the merge gate runs the law's checker and refuses the change if
it fails). Every check, at runtime or at merge, becomes one entry in RIL's provable record, naming
the exact law version that decided. Bend does this only for programs written in Bend; RIL Laws
does it for any language and for actions, not just code.

## 2. Why a language now, and why this does not repeat the old RIL

DESIGN.md said "not a new language for humans", and LESSONS.md rule 4 says "never invent a language
when an API will do". Both still hold for what the old RIL built: a workflow language people had to
write programs in. RIL Laws is different in four checkable ways:

| Old RIL language | RIL Laws |
|---|---|
| Programs: workflows, data, generation steps | Decisions only: a law can say allow, ask or forbid; it cannot do anything |
| Loops, data access, its own SQL clone | No loops, no I/O, no user-defined functions; every law finishes and gives one answer |
| Its own engine for everything | Action laws compile to Cedar; code laws call existing checkers (Kani, tests, linters) |
| 27k lines for the DATA language alone | Budget: spec about 20 pages, core checker a few thousand lines (§10) |

The language exists because a policy file alone cannot say *why* a rule exists, *how strongly it
is backed* or *what checks it in code*. Those three things are what make a law trustworthy and what
no existing standard carries.

## 3. Words used here

- **Law**: one rule, with an id, a plain sentence, a reason and how it is enforced.
- **Law set**: all laws in one file. Its **digest** (SHA-256 of the canonical form, §8) names its
  exact version.
- **Action law**: decided by RIL at runtime for each AI action request.
- **Code law**: checked at merge time by a named checker command on a code change.
- **Evidence level**: how strongly a law is backed: `proved`, `tested` or `watched` (§6).

## 4. Law files

One file per repository or per company: `laws.ril`, UTF-8, at most 1 MiB. Comments start with `#`.
The pilot's `LAWS.md` entries convert one to one.

```
laws "Retvest platform" version 3

law private-work-is-private
  says  "An admin never reads another user's Private Work."
  why   "Private Work is personal, even inside a company account."
  on    action read of PrivateWork
  forbid when resource.owner != principal
  evidence proved by kani "private_work::read_decision" in "rust/api"

law one-company-per-query
  says  "A query only ever reads rows of the caller's company."
  why   "Companies' data must never mix."
  on    code "rust/api/src/**/*.rs"
  evidence tested by command "make laws-tenant"

law export-needs-approval
  says  "Sending customer data outside the company needs a person's approval."
  why   "Data leaving the company is not reversible."
  on    action send of CustomerData
  ask   when resource.destination.external
  evidence watched
```

### Grammar (complete)

```
file      = header law+
header    = "laws" STRING "version" INT
law       = "law" ID says why on rule* evidence
says      = "says" STRING                         # the rule in one plain sentence (≤ 200 chars)
why       = "why" STRING                          # the reason (≤ 300 chars)
on        = "on" ( "action" VERB "of" TYPE | "code" STRING ("," STRING)* )
rule      = ( "permit" | "ask" | "forbid" ) ( "when" expr )?
evidence  = "evidence" ( "proved" "by" TOOL STRING ("in" STRING)?
                       | "tested" "by" "command" STRING
                       | "watched" )
expr      = Cedar condition syntax, restricted as in §5
ID        = [a-z][a-z0-9-]{0,63}      VERB, TYPE = Cedar action and entity type names
TOOL      = "kani" | "verus" | "lean" | "cedar-analysis" | "quint" | "bend"
```

Rules: a `code` law has no `permit`/`ask`/`forbid` lines (its checker is its rule). An `action` law
has at least one rule line. Ids are unique in a file. Anything else is a parse error, and a file
with a parse error decides nothing: every action it covers is denied (§5.3).

## 5. Meaning of action laws

### 5.1 Expressions

Exactly Cedar's condition language, minus anything that can fail to finish or depend on the
outside world. Allowed: `== != < <= > >=`, `&& || !`, `in`, `has`, `like`, `.contains`,
`.containsAll`, `.containsAny`, `if-then-else`, attribute access, set and record literals, 64-bit
checked integers, strings, booleans, entity references. Not allowed: anything not listed. Inputs
are the action request RIL already records (principal, action, resource, context), see
`ril-core/src/record.rs`.

### 5.2 Decision

For one request, every law whose `on action` matches is evaluated:

1. If any `forbid` applies → **deny**.
2. Otherwise, if any `ask` applies → **hold for approval**.
3. Otherwise, if any `permit` applies → **allow**.
4. Otherwise → **deny** (deny by default).

The answer names every law that applied. The order of laws in the file never changes the answer.

### 5.3 Errors fail closed

If a condition cannot be evaluated (missing attribute, overflow, wrong type):

- in a `forbid` or `ask` rule, the rule **applies**;
- in a `permit` rule, the rule **does not apply**.

So an error can only make RIL stricter, never looser. The record states the error and the law. This
is deliberately stricter than Cedar, which skips a policy on error; §9 describes how the compiled
Cedar keeps this behaviour.

### 5.4 Guarantees (each is a test and later a proof)

- **Total**: every request gets exactly one answer.
- **Deterministic**: the same law set and the same request give the same answer, on any machine,
  in any year.
- **Order-free**: reordering laws in the file changes nothing.
- **Monotone in forbid**: adding a `forbid` law can never turn a deny into an allow.

## 6. Code laws and evidence levels

RIL cannot itself prove facts about Rust or Kotlin code. A code law therefore names the checker
that does, and the level says how strong that checker is:

| Level | Means | Accepted checkers |
|---|---|---|
| `proved` | The checker establishes the property within the recorded scope (§20) | `kani`, `verus`, `lean`, `cedar-analysis`, `quint` (record sample and step bounds), `bend` (run `bend check` on `LAWS.bend`) |
| `tested` | Held for every case a test or property test ran | Any command that exits 0 on success |
| `watched` | Not checked before running; enforced and recorded at runtime | none (action laws only) |

Honesty rules:

- A law may only claim `proved` if the gate actually ran one of the proof tools and recorded its
  version and output. Otherwise the gate rejects the law as mislabelled.
- A proof's bounds (for example Kani's unwinding limit) are part of the record.
- Showing `tested` as `proved` anywhere, in the product or in marketing, is a bug.

## 7. Changing laws: the merge gate

On every change to a repository that has `laws.ril`:

1. Parse and type-check the file. A broken file blocks the merge.
2. Run every code law's checker. Any failure blocks the merge.
3. Compare the law set with the base branch:
   - a **new** law passes automatically;
   - **removing** a law, changing its `says`, `on`, rule lines or checker, or **lowering** its
     evidence level is a weakening. It blocks the merge until the owner records an approval;
   - raising an evidence level or rewording `why` passes.
4. Record one law-check entry per law (§8), pass or fail.

So an AI can add laws freely but can never quietly weaken one to get its own change through. This is
the Bend promise, applied to every language Retvest uses.

## 8. The record

RIL's existing action record (intent → decision → approval → effect → outcome, denied and unknown
included, hash-chained, sealed, anchored, verifiable; see DESIGN.md §5–6) gains:

- in every decision: `law_set` (digest of the canonical law set), `laws` (ids that applied),
  `errors` (laws that hit §5.3), and `inputs_digest` (the exact request and entity snapshot used);
- a new record kind, **law check**: repository, commit, law id, checker and its version, evidence
  level, bounds, result, duration and output digest.

**Canonical form**: laws sorted by id, whitespace normalised, comments removed, strings
NFC-normalised, serialised as JSON Canonicalization Scheme (RFC 8785). The digest is SHA-256 of that.

**Replay**: anyone with a record, the law set it names and the snapshot it names can re-run the
decision with the reference checker and must get the same answer. The standalone verifier does this
along with checking the hash chain and anchors.

**What the record cannot say**: RIL only sees actions that pass through it. The coverage map shows
which agents, tools and repositories are governed and which are not, and every export carries that
coverage. Absence of a record is never shown as "nothing happened".

## 9. Reliability: how this is made trustworthy

1. **Meaning before code**: this document's §5 is the source of truth. The checker follows it.
2. **Two implementations**: a small reference evaluator in Rust written straight from §5, and the
   compiled path (laws → Cedar → Cedar's engine). A differential test feeds both millions of random
   law sets and requests; any difference is a bug in one of them. This is the method Amazon used for
   Cedar.
3. **Fail closed on the Cedar path**: Cedar skips a policy whose condition errors, which would be
   looser than §5.3, and Cedar has no way to catch an error inside a condition. So, first, the
   type checker rejects conditions that can error by construction (attribute access needs a `has`
   guard, types must match), using Cedar's validator. Second, for errors that remain (such as
   integer overflow), RIL reads the error diagnostics Cedar returns with every answer and itself
   treats each erroring `forbid`/`ask` law as applied. The differential test checks exactly this
   case.
4. **Proofs later**: once the language is stable, the §5.4 guarantees get a machine-checked proof
   (Lean), as Cedar's were. Until then they are `tested`, and labelled as such.
5. **Simulation tests** for the gate and record: crashes, retries, concurrent merges, clock skew.
6. **Conformance suite**: a public folder of law sets, requests and expected answers. Any
   implementation that claims to be RIL Laws must pass all of it.

## 10. Budget and guardrails (from LESSONS.md)

- Spec: about 20 pages. Core parser + checker + canonical form: a few thousand lines of Rust.
  Going over either needs the owner's approval.
- No loops, I/O, user functions or general programming, ever. A need for them belongs in the
  checked code, not in a law.
- Every feature comes from a real law someone needed, starting with the pilot. No feature is added
  "for completeness".
- Retvest uses each version on its own repositories and its own AI actions before anyone else.
- Status is only "tests pass"; no UNVERIFIED banners, no prose ahead of code.

## 11. Becoming a standard

- Open specification (this document, once stable) and an Apache-2.0 reference checker and verifier.
- The conformance suite (§9.6) is the definition of compatibility.
- Adapters where AI already acts: MCP gateway, Claude Code and Codex hooks (already in ril-core),
  and merge gates for Rust, Kotlin, TypeScript and SQL repositories.
- Interoperate rather than compete: action laws run on Cedar, records export with OpenTelemetry
  GenAI names and follow the IETF Agent Audit Trail fields, record-keeping maps to EU AI Act
  Article 12.

## 12. Order of work

1. Finish the 3-law pilot (running) and convert its `LAWS.md` entries into `laws.ril`.
2. Parser, type checker and canonical form, with tests from this spec's examples.
3. Reference evaluator and the Cedar compiler, with the differential test.
4. Merge gate (§7) in the Dark Factory, replacing the pilot's LAWS.md check.
5. Law-check records and `law_set` in RIL decisions; verifier replay.
6. 20–30 real laws across the server, App, factory and AI actions. Revise this spec from them to 0.2.
7. Publish 1.0 with the conformance suite only after step 6.

## 13. Owner decisions (18 November 2026)

1. **Syntax**: our own `laws.ril` syntax as in §4, with a JSON export for other tools.
2. **Weakening a law** (§7) needs the owner's approval only. No one else can approve it.
3. **Name**: the language is **RIL Laws**; RIL remains the product.
4. **Open source**: publish the specification, reference checker and conformance suite at 0.2,
   after 20–30 real laws (§12 step 6).

## 14. Notes for 0.2 (found while building the parser, 18 November 2026)

The parser (`ril-core/src/laws`) made these choices where 0.1 was silent. The owner accepted all of
them on 18 November; they are normative for 0.2 and implemented.

1. **Condition end**: a `when` condition ends at the end of the line or at `#`, unless a bracket is
   still open, in which case it continues onto the next lines.
2. **No arithmetic**: conditions have no `+ - *`; only literal negative integers. So integer
   overflow cannot occur in a condition, and the overflow wording in §5.3 and §9 is dropped in 0.2.
3. **Rule order**: the canonical form also sorts rules inside a law (by kind, then condition
   text) and code patterns, because order never changes an answer (§5.2), so it does not change
   the digest either.
4. **Exact canonical form** for the conformance suite: condition spacing (single spaces; none
   around `.` and `::`, inside brackets, or before a method's `(`), JSON field names (`on.kind`,
   `evidence.level`, `entity_type`, `crate_path`), and an absent `in` written as `null`.
5. **String escapes**: `\"`, `\\`, `\n`, `\t` only; strings stay on one line.
6. **Length caps** count Unicode code points after NFC normalisation; the 1 MiB file cap counts bytes.
7. **`watched` on a code law** is an error (§6: action laws only).
8. **Action names**: a law's `VERB` is a plain identifier; the Cedar compiler maps `read` to
   `Action::"read"`.
9. **Small rules**: a file needs at least one law; the version is an unsigned 64-bit integer;
   parsing stops at the first error.

## 15. Decided (found while building the evaluator and Cedar compiler, 18 November 2026)

The evaluator (`ril-core/src/laws/eval.rs`) and Cedar compiler (`cedar.rs`) agree on 200,000 random
cases per property. Building them raised five questions; the owner accepted all five proposals on
18 November and they are normative for 0.2.

1. **Which laws an answer names** (§5.2). The *deciding* laws only: the forbids on a deny,
   the asks on a hold, the permits on an allow. Naming overridden permits too would need a second
   Cedar evaluation per request.
2. **Cyclic entity hierarchy** in a request. Deny the whole request with an error under
   `(request)` (Cedar already does this). Invalid entity type names: also deny (the reference
   evaluator checks this too).
3. **Cedar validator step** of §9.3 needs a schema, which `laws.ril` does not declare. The
   validator step is dropped for 0.2; fail-closed rests on reading Cedar's error diagnostics, which
   the differential test confirms. Schemas can come in a later version if real laws need them.
4. **The `errors` list in records** (§8). It lists every law whose condition errored,
   including permits (which then did not apply), so an auditor sees all of them, and every entity
   read that failed, under the key `(entity <Type>::"<id>")` (§17 item 3).
5. **Condition size limit**. At most 512 tokens and 32 levels of nesting per condition,
   so no implementation can run out of stack.

## 16. Decided (found while wiring laws into RIL, 18 November 2026)

Laws now decide live actions, their decisions carry `law_decision` in the record, `POST /v1/law-checks`
records merge-gate results, and `ril verify --laws` replays every law-based decision. Wiring raised
seven questions. The owner accepted all seven proposals on 18 November; they are normative for
0.2. Items marked "Not built yet" are required before 0.2.

1. **Entity data** (most important). Laws only see what the request carries; targets have no
   attributes yet. So a law like `resource.owner != principal` always errors, and its forbid
   applies (fail closed). RIL reads entity attributes from its adapters (Postgres first)
   at decision time; when it does, the full entity snapshot is stored in the record, not only its
   digest, so replay stays possible. Built: `entities.toml` beside `laws.ril` (ril-core/README.md, Laws);
   decisions record the snapshot as `law_decision.entities`.
2. **Names Cedar rejects**: a law's verb and type must be valid Cedar names, so a tool named with
   `-` or `.` cannot be named by a law and is denied by default. Tool names map to Cedar
   names by a fixed, documented rule (e.g. `-` and `.` become `_`), recorded with the decision.
   Built: `-` and `.` become `_`, recorded as `law_decision.law_action` when it differs; the MCP
   gateway refuses a tool list with two tools of one law name; older records replay with the tool's
   own name.
3. **Laws together with Cedar policy files**: the strictest answer wins (forbid in either, then
   ask, then permit); a law set that matches nothing leaves the decision to Cedar. Built.
4. **Law-check records** also carry `law_set` and `reported_by`; the id comes from the content, so
   an identical report is a retry. Add a read endpoint for law checks, and record your
   approvals of weakened laws (§7) in the same chain. Built: `GET /v1/law-checks` and
   `POST /v1/law-approvals` (a `law_approved` row; owner role, in person only; harnesses get 403).
5. **Error wording** differs between Cedar and the reference evaluator; records keep Cedar's text
   and replay compares only which laws errored. Built.
6. **`ril laws check`** should also check conditions (today only loading does). Built: it
   parses every condition, applies the §15 limits and compiles to Cedar, exactly as loading does.
7. **Context shape**: laws see `context.agent`, Cedar policy files see `context.principal`.
   One shape for both before 0.2. Built: both see `principal {type, id}` and `agent {id, type,
   version}` (Cedar's `agent_type` became `agent.type`); law decisions record `context_shape: 2`,
   and older ones replay with shape 1.
   `context.agent.owner` (opportunity 013) is the person an approver named for the agent; it is absent
   when nobody is named, so `!(context.agent has owner)` finds the unowned. RIL reads it from its own
   record, never from the request, and the decision records it as `agent_owner` for replay.

## 17. Decided (found while building entity lookup, 18 November 2026)

Entity lookup is built (§16 item 1): `entities.toml` next to `laws.ril` names one read-only, tenant-
bound SQL query per entity type; the attributes read are stored in the decision and replayed. The
owner accepted all six proposals on 19 November; they are normative for 0.2 and are being built.

1. **Principal attributes**: only targets are looked up. Also look up the principal, with
   roles from the verified token always winning over any database value. Built: the
   principal is read like a target; `roles` and `authority_ref` come only from the token.
2. **Entity references from SQL**: a column named `"name:Type"` becomes the entity `Type::"<value>"`.
   Keep this convention; add parents (`in`) the same way later, when a real law needs them.
   Built and documented as normative (ril-core/README.md, Laws).
3. **Failed reads in `errors`**: recorded under the key `(entity T::"id")`. §15 item 4
   names this key too. Built.
4. **Entity-source version**: record a digest of `entities.toml` with each decision, like
   `law_set`, so an auditor knows which queries produced the facts. Built: `law_decision.entity_sources`
   is SHA-256 of the canonical file (parsed, defaults filled in, RFC 8785 JSON); `ril verify --laws
   ... --entities FILE` needs the matching file.
5. **Time budget**: reads run one after another, each with its own timeout. A total
   budget per decision (default 500 ms); reads past it fail closed. Built: `budget_ms` in
   `entities.toml`; a read past it is cancelled, one it leaves no time for is not started.
6. **Loading**: `entities.toml` and its environment variable are read when the policy folder loads.
   Document it; reload with the policy folder. Built: one load reads all three; each hook run
   loads afresh and `ril serve` at start (ril-core/README.md, Laws).

## 18. Decided (found while building §16 and §17, 19 November 2026)

All of §16 and §17 is built (ril-core main 8c8d1c55). Six points came up; the owner accepted
all six proposals on 19 November. They are normative for 0.2 and built.

1. **Law names for types**: the `-`/`.` → `_` rule covers tool names only. Apply it to
   target kinds and principal types too, recorded the same way. Built: recorded as
   `law_decision.law_types` (each type whose law name differs); `entities.toml` keys are law names;
   older decisions, without it, replay with the types as given.
2. **Colliding tool names in hooks**: Claude Code and Codex hooks never see a tool list, so `a-b`
   and `a_b` share one law there. An optional configured tool list for hook harnesses;
   collisions in it refuse to load. Built: `ril hook claude-code|codex --tools FILE` (`RIL_TOOLS`), one
   name per line; a tool not in it is denied (ril-core/README.md, Laws).
3. **Reload**: `ril serve` reads the policy folder once. Reload on SIGHUP, atomically;
   a broken folder keeps the old one and is reported. Built: reported on stderr; no ledger row, since the
   ledger holds tenants' actions and every decision already names its `policy_set`, `law_set` and
   `entity_sources`.
4. **Replay completeness**: Replay also checks that the snapshot holds exactly the
   entities the named `entities.toml` has queries for. Built: `ril verify --laws ... --entities ...` reports
   any entity missing from or extra in the snapshot.
5. **Owner approvals**: An approval names the exact weakening (base and candidate law
   set digests, law ids) and the merge gate accepts only an approval that matches that diff. Built
   in RIL: `law_approved` records the sorted `laws`, and `GET /v1/law-approvals` answers whether
   an approval matches exactly; the Dark Factory gate asks it.
6. **Reading law checks**: Filters (repository, law, result, time) and cursor paging
   instead of the 1000-record cap. Built: `GET /v1/law-checks` takes `repository`, `law`, `result`,
   `since`, `until`, `limit` (at most 1000) and `cursor` (the `next_cursor` of the page before).

Behaviour changes to know: Cedar policy files that used `context.agent_type` must now use
`context.agent.type` (§16 item 7); `ril serve` picks up a changed policy folder on SIGHUP (point 3).

## 19. Decided (owner, 20 November 2026; ~/Retvest/docs/DECISIONS-2026-11-20.md decision 5)

1. **Licence at 0.2: Apache-2.0.** When 0.2 ships, these parts are published under the
   Apache License, Version 2.0, for its explicit patent grant (the licence of Cedar, Open Policy Agent and
   OpenTelemetry):
   - this specification, `docs/LAWS-SPEC.md`;
   - the conformance suite, `conformance/` (cases, README and its runner
     `ril-core/tests/conformance.rs`);
   - the reference evaluator: `ril-core/src/laws.rs` and `ril-core/src/laws/` `action.rs`,
     `condition.rs`, `eval.rs`, `expr.rs`, `lex.rs`, `parse.rs`, `print.rs`, with the canonical
     JSON and SHA-256 helpers of `ril-core/src/digest.rs` they use.

   The licence text and NOTICE to ship with them are prepared in `docs/laws-0.2/` (`LICENSE`,
   `NOTICE`). Until 0.2 ships, and for everything else in this repository (the Cedar compiler, live
   request mapping, ledger, service, adapters), the proprietary `LICENSE` at the repository root
   applies. Nothing is published before 0.2.
2. **Identity tokens: EdDSA only (decision 6).** RIL never accepts HS256 or any shared-secret
   algorithm, following RFC 8725 §3.1 (accept only the algorithms you expect, one per key) and
   RFC 8037; with HS256 every verifier could also forge tokens. The platform moves its sessions and
   service tokens to EdDSA.

## 20. Owner decisions, 22 November 2026

1. **Proof tools (`quint` and `bend`):** RIL Laws 0.2 accepts `quint` and `bend` in `evidence proved by` (§4 and §6). The tool and
   target are part of the canonical law set (§8). A Quint check records the model and the sample
   and step bounds. A sampled run establishes the property for the traces it checked. A Bend
   check runs `bend check` on `LAWS.bend`.

   The repository's `laws.ril` names five Kani harnesses. They cover self-approval under four eyes,
   authorization before execution, fail-closed precedence for forbids and asks, classification of
   expired, replaced and unknown execution claims, and exact retries of recorded completions.
   The file also names the bounded Quint action lifecycle model and requires the owner role to
   approve weakening a law.

2. **Open Specification + Free Binary (Closed-Source Engine).** When 0.2 ships, the specification
   (`docs/LAWS-SPEC.md`), conformance suite (`conformance/`), and stripped, prebuilt `ril` binaries
   may be openly distributed. Anyone can adopt the format, validate compatibility independently,
   and run the binaries free of charge for `ril laws check`, `ril verify`, `ril verify-receipt`,
   and local governance. All Rust engine source (`ril-core/src/**`), including the reference
   evaluator listed in §19 item 1, remains private and proprietary.
