import base64
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ril_sdk import RilClient, RilError  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
BIN = next(
    (p for p in [
        os.environ.get("RIL_BIN"),
        str(ROOT / "ril-core/target/debug/ril"),
        str(ROOT / "ril-core/target/release/ril"),
    ] if p and os.path.exists(p)),
    None,
)
# Signed by `ril-core/examples/receipt_fixture.rs` (fixed test-only seed): 2 rows of action a1.
FIXTURES = ROOT / "sdks/fixtures"
RECEIPT = str(FIXTURES / "receipt.json")
PUB_PEM_PATH = str(FIXTURES / "seal.pub.pem")
PUB_PEM = (FIXTURES / "seal.pub.pem").read_text()
PUB_HEX = base64.b64decode(re.sub(r"-----[^-]+-----|\s", "", PUB_PEM))[-32:].hex()
SETTLEMENT = str(ROOT / "examples/settlement.ril")
QUORUM = str(ROOT / "packs/quorum-settlement.ril")


@unittest.skipUnless(BIN, "ril binary not built (cargo build --manifest-path ril-core/Cargo.toml)")
class RilSdkTest(unittest.TestCase):
    def setUp(self):
        self.ril = RilClient(BIN)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def write(self, name, text):
        p = os.path.join(self.tmp.name, name)
        with open(p, "w") as fh:
            fh.write(text)
        return p

    def test_check_settlement(self):
        r = self.ril.check(SETTLEMENT)
        self.assertTrue(r.ok, r.raw)
        self.assertEqual(r.name, "Retvest Payment Settlement")
        self.assertEqual(len(r.digest), 64)
        self.assertGreater(r.machines[0]["states_explored"], 0)
        self.assertEqual(r.diagnostics, [])

    def test_check_quorum_pack(self):
        r = self.ril.check(QUORUM)
        self.assertTrue(r.ok, r.raw)
        self.assertEqual(r.machines[0]["id"], "quorum-settlement")

    def test_test_inline(self):
        r = self.ril.test(SETTLEMENT)
        self.assertTrue(r.ok)
        self.assertEqual(r.passed, len(r.tests))
        self.assertIn("deny", [t.verdict for t in r.tests])

    def test_broken_file_diagnostics(self):
        bad = self.write("broken.ril", "law x {\n")
        r = self.ril.check(bad)
        self.assertFalse(r.ok)
        self.assertEqual(len(r.diagnostics), 1)
        d = r.diagnostics[0]
        self.assertEqual(d.kind, "parse")
        self.assertEqual(d.line, 1)
        self.assertIsInstance(d.column, int)
        self.assertIn("expected", d.message)
        self.assertFalse(self.ril.test(bad).ok)

    def test_missing_file_is_io_diagnostic(self):
        r = self.ril.check("/nonexistent/nope.ril")
        self.assertFalse(r.ok)
        self.assertEqual(r.diagnostics[0].kind, "io")

    def test_codegen(self):
        ts = self.ril.codegen(SETTLEMENT, "ts")
        self.assertTrue(ts)
        self.assertTrue(self.ril.codegen(SETTLEMENT, lang="rust"))
        out = os.path.join(self.tmp.name, "guards.ts")
        self.assertEqual(self.ril.codegen(SETTLEMENT, "ts", out), ts)

    def test_codegen_broken_raises(self):
        with self.assertRaises(RilError):
            self.ril.codegen(self.write("b.ril", "nonsense\n"), "ts")

    def test_spec(self):
        self.assertIn("RIL v3 Language Grammar", self.ril.spec())

    def test_verify_receipt_bogus(self):
        receipt = self.write("r.json", "{}")
        ok, output = self.ril.verify_receipt(receipt, "00" * 32)
        self.assertFalse(ok)
        self.assertIsInstance(output, str)

    def test_verify_receipt_accepts_real_signed_receipt(self):
        for key in (PUB_HEX, PUB_PEM, PUB_PEM_PATH):
            ok, output = self.ril.verify_receipt(RECEIPT, key)
            self.assertTrue(ok, output)
            self.assertIn("receipt verified: 2 rows of action a1 (tenant acme)", output)

    def test_verify_receipt_one_byte_tamper_flips_to_false(self):
        with open(RECEIPT, encoding="utf-8") as fh:
            original = fh.read()
        self.assertIn("10:00:01", original)
        tampered = self.write("tampered.json", original.replace("10:00:01", "10:00:02", 1))
        ok, output = self.ril.verify_receipt(tampered, PUB_HEX)
        self.assertFalse(ok, output)
        self.assertIn("NOT verified", output)

    def test_verify_receipt_rejects_other_key(self):
        ok, output = self.ril.verify_receipt(RECEIPT, "11" * 32)
        self.assertFalse(ok, output)


class MissingBinaryTest(unittest.TestCase):
    def test_missing_binary(self):
        with self.assertRaises(RilError):
            RilClient("/nonexistent/ril").spec()


if __name__ == "__main__":
    unittest.main()
