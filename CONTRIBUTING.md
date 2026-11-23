# Contributing to RIL

RIL follows the **Open Specification + Free Binary** model. Every file in this repository—`LAWS-SPEC.md`, the 10-case `conformance/` suite, starter `examples/`, editor syntax grammars, and installers—is Apache-2.0 and welcomes community pull requests.

## High-Impact Contributions

| Area | What to Submit | Verification |
|---|---|---|
| Starter `laws.ril` packs | Reusable guardrails for Claude Code, Cursor, Codex, MCP servers, Go, Rust, Python, TypeScript, SQL, or Terraform under `examples/`. | Must pass `ril laws check <file>` and include a tested `ril laws eval` example. |
| Conformance test cases | New edge-case vectors in `conformance/` exercising precedence, `has` guards, `like` patterns, or fail-closed errors. | Must follow `conformance/README.md` JSON schema and reference the exact `LAWS-SPEC.md` section. |
| Editor & syntax integrations | Grammars or plugins for VS Code, Cursor, Neovim (Tree-sitter), Zed, JetBrains, or Shiki under `editors/`. | Must highlight keywords, verdicts (`permit`, `ask`, `forbid`), proof tools, and strings cleanly. |
| Alternative implementations | Independent checkers or evaluators in Rust, Go, TypeScript, Python, or Zig implementing `LAWS-SPEC.md`. | Must pass all cases in `conformance/` (`001`–`010`) and produce identical RFC 8785 digests. |

## Security Disclosures

Report vulnerabilities privately to `security@retvest.com` rather than opening a public issue.
