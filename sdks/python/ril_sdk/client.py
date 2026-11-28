"""Typed wrapper around the `ril` command line. Standard library only."""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Any

# ASN.1 SubjectPublicKeyInfo prefix for a raw Ed25519 public key.
_ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")


class RilError(RuntimeError):
    """The CLI could not be run or produced no structured result."""

    def __init__(self, message: str, stdout: str = "", stderr: str = "", status: int | None = None):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr
        self.status = status


@dataclass
class RilDiagnostic:
    kind: str
    message: str
    line: int | None = None
    column: int | None = None
    hint: str | None = None


@dataclass
class RilTestCase:
    id: str
    law: str
    verdict: str


@dataclass
class RilCheckResult:
    ok: bool
    name: str | None = None
    version: int | None = None
    digest: str | None = None
    laws: int | None = None
    promises: int | None = None
    machines: list[dict[str, Any]] = field(default_factory=list)
    proofs: list[dict[str, Any]] = field(default_factory=list)
    tests: list[RilTestCase] = field(default_factory=list)
    diagnostics: list[RilDiagnostic] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class RilTestResult:
    ok: bool
    passed: int = 0
    tests: list[RilTestCase] = field(default_factory=list)
    diagnostics: list[RilDiagnostic] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


def _diagnostics(raw: dict[str, Any]) -> list[RilDiagnostic]:
    return [
        RilDiagnostic(
            kind=d.get("kind", ""),
            message=d.get("message", ""),
            line=d.get("line"),
            column=d.get("column"),
            hint=d.get("hint"),
        )
        for d in raw.get("diagnostics", [])
    ]


def _tests(raw: dict[str, Any]) -> list[RilTestCase]:
    return [RilTestCase(id=t["id"], law=t["law"], verdict=t["verdict"]) for t in raw.get("tests", [])]


class RilClient:
    def __init__(self, bin_path: str = "ril"):
        self.bin_path = bin_path

    def _run(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                [self.bin_path, *args], capture_output=True, text=True, check=False
            )
        except OSError as exc:
            raise RilError(f"cannot run `{self.bin_path}`: {exc}") from exc

    def _run_json(self, cmd: str, file_path: str) -> dict[str, Any]:
        # Exit 1 with a JSON body is a normal verification failure, not an exception.
        r = self._run([cmd, os.fspath(file_path), "--json"])
        try:
            raw = json.loads(r.stdout)
        except json.JSONDecodeError as exc:
            raise RilError(
                f"ril {cmd}: no JSON on stdout (exit {r.returncode}): {r.stderr or r.stdout}",
                r.stdout, r.stderr, r.returncode,
            ) from exc
        return raw

    def check(self, file_path: str) -> RilCheckResult:
        raw = self._run_json("check", file_path)
        return RilCheckResult(
            ok=raw.get("ok") is True,
            name=raw.get("name"),
            version=raw.get("version"),
            digest=raw.get("digest"),
            laws=raw.get("laws"),
            promises=raw.get("promises"),
            machines=raw.get("machines", []),
            proofs=raw.get("proofs", []),
            tests=_tests(raw),
            diagnostics=_diagnostics(raw),
            raw=raw,
        )

    def test(self, file_path: str) -> RilTestResult:
        raw = self._run_json("test", file_path)
        return RilTestResult(
            ok=raw.get("ok") is True,
            passed=raw.get("passed", 0),
            tests=_tests(raw),
            diagnostics=_diagnostics(raw),
            raw=raw,
        )

    def codegen(self, file_path: str, lang: str = "ts", out_path: str | None = None) -> str:
        args = ["codegen", os.fspath(file_path), "--lang", lang]
        if out_path:
            args += ["--out", os.fspath(out_path)]
        r = self._run(args)
        if r.returncode != 0:
            raise RilError(f"ril codegen failed: {r.stderr.strip()}", r.stdout, r.stderr, r.returncode)
        if out_path:
            with open(out_path, encoding="utf-8") as fh:
                return fh.read()
        return r.stdout

    def spec(self) -> str:
        r = self._run(["spec"])
        if r.returncode != 0:
            raise RilError(f"ril spec failed: {r.stderr.strip()}", r.stdout, r.stderr, r.returncode)
        return r.stdout

    def verify_receipt(self, receipt_path: str, public_key_hex: str) -> tuple[bool, str]:
        """`public_key_hex`: 64 hex chars (raw Ed25519), PEM text, or a PEM file path."""
        key = public_key_hex.strip()
        with tempfile.TemporaryDirectory(prefix="ril-sdk-") as tmp:
            key_path = key
            if re.fullmatch(r"[0-9a-fA-F]{64}", key):
                der = _ED25519_SPKI_PREFIX + bytes.fromhex(key)
                pem = "-----BEGIN PUBLIC KEY-----\n" + base64.b64encode(der).decode() + "\n-----END PUBLIC KEY-----\n"
            elif "BEGIN PUBLIC KEY" in key:
                pem = key + "\n"
            elif os.path.exists(key):
                pem = None
            else:
                raise RilError("public_key_hex must be 64 hex chars, PEM text, or a PEM file path")
            if pem is not None:
                key_path = os.path.join(tmp, "seal.pub.pem")
                with open(key_path, "w", encoding="utf-8") as fh:
                    fh.write(pem)
            r = self._run(["verify-receipt", os.fspath(receipt_path), "--public-key", key_path])
        return r.returncode == 0, (r.stdout + r.stderr).strip()

    def evaluate(
        self,
        law_file: str,
        action: str,
        *,
        actor: str = "Agent:ai",
        resource: str = "Resource:default",
        context: dict[str, Any] | None = None,
        entities: list[str] | None = None,
    ) -> dict[str, Any]:
        """Evaluate an action against a law file."""
        args = ["laws", "eval", os.fspath(law_file), "--action", action, "--resource", resource, "--principal", actor]

        if context:
            args += ["--context", json.dumps(context)]

        for entity in entities or []:
            args += ["--entity", entity]

        args.append("--json")

        r = self._run(args)
        try:
            raw = json.loads(r.stdout)
        except json.JSONDecodeError as exc:
            raise RilError(
                f"ril laws eval: no JSON on stdout (exit {r.returncode}): {r.stderr or r.stdout}",
                r.stdout, r.stderr, r.returncode,
            ) from exc

        return {
            "verdict": raw.get("verdict", "deny"),
            "laws": raw.get("laws", []),
            "errors": raw.get("errors", {}),
            "law_set_digest": raw.get("law_set_digest", ""),
            "raw": raw,
        }
