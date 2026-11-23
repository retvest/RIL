# RIL Language Specification (v0.2)

## 1. Scope

RIL defines policy decisions for AI action requests and checks for changes to
code. An action law produces an allow, hold or deny decision at the action
boundary. A code law associates source paths with a check that runs at the
merge gate. A decision or check can be traced to the exact law set that governed
it.

### 1.1 Licensing

The language specification, conformance suite, starter policies, editor grammar
and installer scripts are licensed under [Apache-2.0 (Part II of LICENSE)](LICENSE).
The native RIL engine, including its reference evaluator and verifier, is
proprietary and closed source. Retvest distributes the prebuilt `ril` and
`ril.exe` binaries free of charge under the
[Retvest Free Binary License](BINARY-LICENSE.txt).

## 2. Language boundaries

A law declares its scope, the rule and its evidence. The language has no
loops, I/O, arithmetic or user-defined functions. Action conditions use the
restricted Cedar expression language in §5.1. Code laws identify external
checkers; running a checker is the responsibility of the merge gate (§7).

## 3. Terminology

| Term | Meaning |
| --- | --- |
| Law | A rule with an identifier, a description, a reason, an enforcement scope and an evidence level. |
| Law set | The laws in one file, identified by the SHA-256 digest of their canonical representation (§8). |
| Action law | A law evaluated for a request whose action and resource type match its scope. |
| Code law | A law that binds a checker to one or more source path patterns. |
| Evidence level | One of `proved`, `tested` or `watched` (§6). |

## 4. Law files

A law set is a UTF-8 `laws.ril` file of at most 1 MiB (1,048,576 bytes). It
contains one header and at least one law. Outside quoted strings, `#` starts a
comment that runs to the end of the line.

```text
file      = header law+
header    = "laws" STRING "version" INT
law       = "law" ID says why on rule* evidence
says      = "says" STRING
why       = "why" STRING
on        = "on" ( "action" VERB "of" TYPE | "code" STRING ("," STRING)* )
rule      = ( "permit" | "ask" | "forbid" ) ( "when" expr )?
evidence  = "evidence" ( "proved" "by" TOOL STRING ("in" STRING)?
                       | "tested" "by" "command" STRING
                       | "watched" )
expr      = restricted Cedar condition (§5.1)
ID        = [a-z][a-z0-9-]{0,63}
INT       = unsigned 64-bit integer
VERB      = [A-Za-z_][A-Za-z0-9_]*
TYPE      = Cedar entity type name (one or more identifiers separated by "::")
TOOL      = "kani" | "verus" | "lean" | "cedar-analysis" | "quint" | "bend"
```

1. Law IDs are unique within the file.
2. A grammar `STRING` is double-quoted and stays on one source line. Its only
   escapes are `\"`, `\\`, `\n` and `\t`. Conditions use Cedar literals (§5.1).
   After decoding and NFC normalization, `says` is at most 200 Unicode code
   points and `why` is at most 300.
3. An action law requires one or more rules. A rule without `when` is
   unconditional. A code law requires one or more quoted path patterns, has
   no action rules, and cannot use `watched`.
4. A `when` condition ends at the line break or the start of a comment, outside
   quoted strings. An open `(`, `[` or `{` continues the condition onto the
   next line. Delimiters must balance.
5. Parsing stops at the first error and rejects the whole file. A rejected law
   set cannot authorize an action. `ril laws check` applies the same condition
   checks and Cedar compilation as policy loading.

```text
laws "Example project" version 3

law private-work-is-private
  says "An admin never reads another user's Private Work."
  why "Private Work is personal."
  on action read of PrivateWork
  forbid when resource.owner != principal
  evidence proved by kani "private_work::read_decision" in "rust/api"

law one-tenant-per-query
  says "A query only reads rows belonging to the caller's tenant."
  why "Tenant data must stay isolated."
  on code "rust/api/src/**/*.rs"
  evidence tested by command "make laws-tenant"

law export-needs-approval
  says "External exports need human approval."
  why "External transfers cannot be recalled."
  on action send of CustomerData
  ask when context.destination.external
  evidence watched
```

## 5. Action evaluation

### 5.1 Expressions

Conditions use Cedar syntax and evaluate against `principal`, `action`,
`resource` and `context`. Allowed forms are:

| Form | Syntax |
| --- | --- |
| Comparisons | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| Boolean operators | `&&`, `\|\|`, `!` |
| Membership, attribute presence and patterns | `in`, `has`, `like` |
| Set methods | `.contains`, `.containsAll`, `.containsAny` |
| Conditional expressions | `if … then … else …` |
| Values | Booleans, signed 64-bit integer literals, Cedar strings, entity references, sets and records |
| Access and grouping | Attribute access and parentheses |

Boolean operators short-circuit. Integer literals may be negative. Arithmetic
operators are prohibited. Other Cedar operators and function calls are outside
the language. Conditions may contain at most 512 tokens and 32 levels of
nesting.

### 5.2 Decision

Evaluate the rules of each action law whose verb matches the request action
and whose entity type matches the request resource type. The Cedar action
entity for a verb such as `read` is `Action::"read"`.

| Applicable rules, in descending priority | Verdict | Deciding law IDs |
| --- | --- | --- |
| Any `forbid` | Deny | Laws with an applicable `forbid` |
| Any `ask` | Hold for approval | Laws with an applicable `ask` |
| Any `permit` | Allow | Laws with an applicable `permit` |
| None | Deny | Empty |

Return the deciding IDs once each, sorted by ID. A request with multiple targets
is evaluated once per target; use the strictest result. When a law set is used
alongside Cedar policy files, an explicit deny from either takes precedence,
followed by a hold and then an allow. If no law applies, the Cedar policies
supply the result. With a law set alone, the default remains deny.

The standalone `ril laws eval` command evaluates the supplied policy and request
offline, without a database. Its exit codes are 0 for allow, 2 for hold and 3
for deny. A command or input failure exits 1.

### 5.3 Errors fail closed

A condition with a missing attribute, a wrong type or another evaluation
error makes a `forbid` or `ask` apply and leaves a `permit` inapplicable. Report
every law whose condition errors, including permits. An invalid request, such
as a cyclic entity hierarchy or an invalid entity type, is denied with no
deciding law and an error under `(request)`. A failed entity read is reported
under `(entity Type::"id")` (§8).

### 5.4 Evaluation guarantees

For a fixed request and entity snapshot, evaluation is total and deterministic.
Changing law or rule order does not change the result. Adding an applicable
forbid cannot make the verdict less restrictive.

## 6. Code laws and evidence levels

| Level | Requirement |
| --- | --- |
| `proved` | Run the named proof tool against the named target. Record the checker version, output digest and scope, including bounds. |
| `tested` | Run the named command. Exit status zero means the cases exercised passed. |
| `watched` | Enforce and record the law at runtime. This level is available only to action laws. |

Accepted proof tools are `kani`, `verus`, `lean`, `cedar-analysis`, `quint` and
`bend`. A Quint check records its model and sample and step bounds. A sampled
run establishes the result for the traces it checked. A Bend check runs
`bend check` on the `LAWS.bend` target. Kani checks record their applicable
unwinding bounds. A gate may report `proved` only if it actually ran the named
checker and recorded its evidence.

## 7. Merge gate and law changes

1. Load and check the candidate law set. Invalid syntax or conditions block
   the merge.
2. Run the code-law checkers. A failed required check blocks the merge.
3. Compare the candidate with the base by law ID. Additions and strengthening
   need no weakening approval. Removing a law, changing its action scope or
   kind, narrowing its code scope, removing or changing an ask or forbid,
   adding or changing a permit, lowering the evidence level, or changing a
   checker at the same evidence level is weakening. Description and reason
   edits alone are metadata changes.
4. Block a weakening until the repository owner approves it in person. Match
   the approval against the exact base and candidate law-set digests and
   sorted IDs of the weakened laws. Record the approval in the same chain.
5. Record a law-check result for each check, including failures (§8).

The standalone `ril laws diff` command exits 1 when it detects a weakening.
The merge gate is responsible for requiring a passing result or matching
owner approval.

## 8. Canonical form and records

### 8.1 Canonical law set

Decode grammar strings and normalize them to Unicode NFC. Discard comments and
formatting outside string values. Keep conditions as NFC-normalized Cedar
source with one space between tokens, except immediately after an opening
delimiter or `!`, immediately before a closing delimiter, comma or colon,
around `.` and `::`, and before the opening parenthesis of a set method.
Condition string tokens retain their escape spelling.

Sort laws by ID, code globs by text, and rules by kind in the order `permit`,
`ask`, `forbid`, then by condition text (absent before present). Text sorting
uses lexicographic UTF-8 byte order. Preserve duplicate rules and globs.
Serialize the following shapes as UTF-8 JSON using RFC 8785 and hash those
bytes with SHA-256. The canonical JSON is also the interchange export.

| Object | Exact fields or variants |
| --- | --- |
| Law set | `name`, `version` (integer), `laws` (array) |
| Law | `id`, `says`, `why`, `on`, `rules` (array), `evidence` |
| Action scope | `kind: "action"`, `verb`, `entity_type` |
| Code scope | `kind: "code"`, `globs` (array of strings) |
| Rule | `kind` (`"permit"`, `"ask"` or `"forbid"`), `when` (canonical condition string or `null`) |
| Proof evidence | `level: "proved"`, `tool`, `target`, `crate_path` (string or `null` when `in` is absent) |
| Test evidence | `level: "tested"`, `command` |
| Runtime evidence | `level: "watched"` |

### 8.2 Decision and check records

An action record carries its intent, decision, any approval, effect and
outcome in a hash chain. A law-based decision includes `law_decision` with
`law_set`, `verdict`, `laws`, `errors` and `inputs_digest`. The inputs digest
is the SHA-256 of the canonical law requests and entity snapshot evaluated
for the decision. The chain retains the original request.

`law_decision.entities` stores the entity snapshot, including attributes or
read failures, so replay has the data used at decision time. When the policy
folder contains `entities.toml`, `law_decision.entity_sources` is the SHA-256
of the parsed configuration with defaults filled in, serialized as RFC 8785
JSON. The record also carries changed `law_action` and `law_types` names,
`context_shape` and the recorded `agent_owner` when applicable (§10).

A law-check entry identifies the repository, commit, law ID, law-set digest,
checker and version, evidence level and bounds, result, duration, output
digest and reporting identity (`reported_by`). Its ID derives from the
content, so an identical report is a retry. Owner approvals identify the
exact weakening as defined in §7.

The server accepts check reports at `POST /v1/law-checks`. Its
`GET /v1/law-checks` endpoint filters by `repository`, `law`, `result`, `since`
and `until`; pages use `limit` (at most 1000) and the previous page's
`next_cursor` as `cursor`. `POST /v1/law-approvals` creates a `law_approved`
record with the sorted `laws` for an in-person owner approval. The endpoint
rejects agent harnesses with HTTP 403. `GET /v1/law-approvals` checks for a
matching approval.

### 8.3 Replay and coverage

`ril verify --laws` re-evaluates the recorded request using its law-set digest,
recorded names and context shape, and recorded entity snapshot. When a record
names entity sources, supply the matching configuration with `--entities FILE`.
Replay verifies that
the snapshot contains exactly the entities that the configuration required.
It checks the input digest, verdict, deciding laws and error identities.
Records retain Cedar's diagnostic text. Replay uses the recorded entity data
and compares error identities independently of their text. A mismatch or a
recorded effect looser than the laws allow fails verification.

Coverage is limited to requests that pass through the runtime and code
changes that pass through the merge gate. An absent record establishes no
result for activity outside that coverage.

## 9. Reliability: how this is made trustworthy

### 9.1 Evaluation paths

The reference evaluator and Cedar-compiled path must agree on verdicts,
deciding law IDs and error identities. Cedar diagnostics must be used to
apply §5.3, because Cedar otherwise skips an erroring policy. A v0.2 law set
does not declare a Cedar schema and loading does not require schema validation.

### 9.2 Conformance suite

An implementation claiming v0.2 compatibility must pass the public
[conformance cases](conformance/README.md). The cases cover parsing, canonical
digests and action decisions, including errors. The suite specifies observable
behavior; differential tests compare the two native evaluation paths.

## 10. Runtime inputs and identity

1. **Name mapping.** Replace each `-` and `.` in an incoming tool name,
   principal type or target kind with `_`. Record a changed tool name as
   `law_action` and changed types as `law_types`. Entity source keys use the
   mapped type. Older records without those fields replay with their original
   names. Reject tool-list collisions at the MCP gateway or in a configured
   Claude Code or Codex hook list. Configure a hook list with `--tools FILE` or
   `RIL_TOOLS`, with one tool name per line. A configured hook denies tools
   outside its list. Without a list, names that map to the same identifier
   share its laws.
2. **Request shape.** The resource is the target entity, or `Tool::"<tool name>"`
   if there is no target. Cedar policies and RIL laws share context shape 2,
   including `context.principal` with `type` and `id`, and `context.agent` with
   `id`, `type` and `version`. Shape 2 uses `context.agent.type` in place of
   `context.agent_type`. Records specify `context_shape: 2` and older records
   without it replay with shape 1. Set `context.agent.owner` only
   from the recorded owner named by an approver. Omit it when no owner is named.
3. **Entity sources.** Load `entities.toml`, its named environment variable
   and the law and Cedar files as one policy folder. Configure one read-only,
   tenant-bound SQL query per mapped entity type. Query the principal and
   each target with a configured type. Run reads sequentially under a per-read
   timeout and the total `budget_ms` per decision (default 500 ms). Cancel a
   read that exceeds the remaining budget and treat a read that cannot start
   within it as failed. A failed read supplies no database attributes and is
   recorded as in §5.3. Verified identity tokens are the only source of
   principal `roles` and `authority_ref`.
4. **Entity references.** A database column named `<name>:<Type>` supplies
   attribute `<name>` with entity value `<Type>::"<value>"`. Split the column
   name at its first colon. Entity parents are not populated by these reads.
5. **Policy reload.** A hook loads the folder afresh, and `ril serve` loads it
   at startup. The running server reloads it atomically on SIGHUP. A failed
   reload reports the error on stderr and retains the previously loaded folder.
   Reloads do not create a ledger entry. Each decision names the applicable
   `policy_set`, `law_set` and `entity_sources`.
6. **Identity tokens.** Accept only EdDSA for signed identity tokens. Reject
   HS256 and other shared-secret signing algorithms. Validate the expected
   algorithm for each key as specified in RFC 8725 §3.1 and RFC 8037.
