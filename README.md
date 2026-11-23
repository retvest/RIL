<p align="center"><img src="assets/ril-logo.svg" alt="RIL by Retvest" width="280" /></p>

# RIL

RIL is a policy language and local engine for AI agents. Write a `laws.ril` file
to decide which actions can run, which wait for human approval, and which are
blocked. In CI, compare a pull request with its base policy to catch rules that
have been removed or weakened.

[Download v0.2.1](https://github.com/retvest/ril/releases/tag/v0.2.1) ·
[Try RIL in your browser](https://retvest.com/developers/#ril-install) ·
[Read the specification](LAWS-SPEC.md)

## A policy for file access

```ril
laws "File access" version 1

law protect-files
  says "Protect sensitive files."
  why "Limit unintended access."
  on action read of File
  forbid when context.secret
  ask when context.shared
  permit
  evidence watched
```

An agent hook supplies the file and its context. A matching `forbid` wins over
`ask`, which wins over `permit`. An unmatched action or an evaluation error
fails closed.

## Quickstart

Download the native archive for your platform from the [v0.2.1 release][release]
and verify it against [SHA256SUMS.txt][checksums]. Extract `ril` (or `ril.exe`
on Windows) and put it on your PATH. The release supports macOS arm64, Linux
x86_64 and arm64, and Windows x86_64.

Save the policy above as `laws.ril`, then try these commands. The sample request
returns `HOLD (ask)` with exit code `2`. An allowed action exits `0` and a
denied action exits `3`.

```sh
ril laws check laws.ril
ril laws eval laws.ril --action read --resource File:notes.md --principal Agent:demo --context '{"secret":false,"shared":true}'
```

For an existing project, `ril laws init --template claude-code` generates a
starter. Use `ril laws diff base.ril laws.ril` in CI with the policy from the
base branch saved as `base.ril`. Use `ril laws coverage` to see which files
are covered by code laws tied to tests or proof harnesses.

| Integration | Start here |
| --- | --- |
| Claude Code | [Agent hook and policy](examples/claude-code-mcp/) |
| GitHub Actions | [Pull request workflow](examples/github-action.yml) |
| Rust + Kani | [Rust starter policy](examples/rust-kani/) |
| Python | [FastAPI starter policy](examples/python-fastapi/) |
| TypeScript | [Next.js starter policy](examples/typescript-nextjs/) |

## Licensing

| Component | License |
| --- | --- |
| Native engine (`ril` and `ril.exe`), including the reference evaluator and verifier | Proprietary, closed source and free of charge under the [Retvest Free Binary License](BINARY-LICENSE.txt) |
| [Language specification](LAWS-SPEC.md), [10-case conformance suite](conformance/), [starter packs](examples/), [editor grammar](editors/), and installer scripts ([shell](install.sh) and [PowerShell](install.ps1)) | [Apache-2.0 (Part II of LICENSE)](LICENSE) |

Retvest is an independent, non-commercial software project. See
[CONTRIBUTING.md](CONTRIBUTING.md) to contribute a starter policy, conformance
case, or editor integration.

[release]: https://github.com/retvest/ril/releases/tag/v0.2.1
[checksums]: https://github.com/retvest/ril/releases/download/v0.2.1/SHA256SUMS.txt
