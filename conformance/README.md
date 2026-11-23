# RIL conformance suite

These ten cases define expected behavior for implementations of
[RIL](../LAWS-SPEC.md#9-reliability-how-this-is-made-trustworthy). The cases cover policy loading,
canonical digests and action decisions, including failures. Compare an
implementation’s answers with the expected values in every JSON file.

## Case files

One JSON file per case, named `NNN-what-it-shows.json`, read in name order. Fields:

| Field            | Meaning                                                                    |
|------------------|----------------------------------------------------------------------------|
| `spec`           | the LAWS-SPEC sections the case checks, such as `"§5.2"`                     |
| `about`          | the rule the case shows, in one or two sentences                           |
| `laws`           | a law file (UTF-8 text) that must load                                     |
| `digest`         | optional: the SHA-256 (hex) of the canonical form of `laws` (§8)           |
| `same_law_set`   | optional: other files that must load with the same digest as `laws`       |
| `other_law_sets` | optional: other files that must load with a different digest              |
| `decisions`      | optional: requests and the answer `laws` must give each of them            |
| `refused`        | optional: files that must be refused as a whole (they decide nothing)     |

Each decision has `request`, `verdict` (`allow`, `hold` or `deny`), `laws` (the ids of the laws
that applied, sorted) and `errors` (the ids of the laws whose condition could not be evaluated,
sorted; `(request)` when the request itself cannot be evaluated).

A request is the action RIL decides, with the entities it knows:

```json
{
  "principal": { "entity_type": "User", "id": "alice" },
  "action": "read",
  "resource": { "entity_type": "Doc", "id": "w1" },
  "context": { "amount": { "long": "500" } },
  "entities": [
    [ { "entity_type": "User", "id": "alice" },
      { "attributes": {}, "parents": [ { "entity_type": "Group", "id": "admins" } ] } ]
  ]
}
```

Values are tagged with their kind: `{"bool": true}`, `{"long": "-5"}` (a string, so every 64-bit
value survives JSON), `{"string": "x"}`, `{"entity": {"entity_type": "User", "id": "bob"}}`,
`{"set": [...]}` and `{"record": {"name": value}}`. `entities` is a list of `[entity, data]` pairs;
an entity's `parents` are the entities it is directly in.

## Adding a case

Name the spec section it checks, keep it to one rule, and run the suite: a new case must pass on
both evaluators before it is committed. A change to an expected answer is a change to the language
and needs the owner's decision recorded in LAWS-SPEC.
