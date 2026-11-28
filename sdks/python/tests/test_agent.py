import asyncio
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ril_sdk import RilApprovalRequiredError, RilClient, RilDeniedError, RilToolGuard, ril_govern  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
BIN = next(
    (
        p
        for p in [
            os.environ.get("RIL_BIN"),
            str(ROOT / "ril-core/target/debug/ril"),
            str(ROOT / "ril-core/target/release/ril"),
        ]
        if p and os.path.exists(p)
    ),
    None,
)
LAW_FILE = str(ROOT / "sdks/fixtures/agent-test.ril")


def make_client_with_evaluate(ril_client, evaluate_override):
    """Create a client with a custom evaluate function."""
    client = RilClient(ril_client.bin_path)
    client.evaluate = evaluate_override
    return client


@unittest.skipUnless(BIN, "ril binary not built (cargo build --manifest-path ril-core/Cargo.toml)")
class RilAgentTest(unittest.TestCase):
    def setUp(self):
        self.ril = RilClient(BIN)
        self.executed = False
        self.decision_received = None

    def test_sync_allowed_action_executes(self):
        """Synchronous allowed tool executes and returns value."""

        def read_safe_file(filename):
            self.executed = True
            return f"contents of {filename}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "read", resource="File:test.txt", entities=['File:test.txt={"safe":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "read")(read_safe_file)
        result = governed("test.txt")

        self.assertEqual(result, "contents of test.txt")
        self.assertTrue(self.executed, "wrapped function should have executed")

    def test_async_allowed_action_executes(self):
        """Asynchronous allowed tool executes and returns value."""

        async def read_safe_file_async(filename):
            self.executed = True
            await asyncio.sleep(0.001)
            return f"contents of {filename}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "read", resource="File:test.txt", entities=['File:test.txt={"safe":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "read")(read_safe_file_async)
        result = asyncio.run(governed("test.txt"))

        self.assertEqual(result, "contents of test.txt")
        self.assertTrue(self.executed, "wrapped function should have executed")

    def test_sync_denied_action_raises_and_prevents_execution(self):
        """Synchronous denied tool raises RilDeniedError and proves side-effect never ran."""

        def write_dangerous_file(filename, content):
            self.executed = True
            return f"wrote {content} to {filename}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "write", resource="File:danger.sh", entities=['File:danger.sh={"dangerous":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "write")(write_dangerous_file)

        with self.assertRaises(RilDeniedError) as ctx:
            governed("danger.sh", "rm -rf /")

        self.assertEqual(ctx.exception.verdict, "deny")
        self.assertEqual(ctx.exception.action, "write")
        self.assertIsNotNone(ctx.exception.matched_law)
        self.assertFalse(self.executed, "wrapped function should NOT have executed")

    def test_async_denied_action_raises_and_prevents_execution(self):
        """Asynchronous denied tool raises RilDeniedError and proves side-effect never ran."""

        async def write_dangerous_file_async(filename, content):
            self.executed = True
            await asyncio.sleep(0.001)
            return f"wrote {content} to {filename}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "write", resource="File:danger.sh", entities=['File:danger.sh={"dangerous":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "write")(write_dangerous_file_async)

        with self.assertRaises(RilDeniedError):
            asyncio.run(governed("danger.sh", "rm -rf /"))

        self.assertFalse(self.executed, "wrapped function should NOT have executed")

    def test_sync_ask_without_on_ask_raises_approval_required(self):
        """ask tool without on_ask raises RilApprovalRequiredError and side-effect never runs."""

        def access_sensitive(data_id):
            self.executed = True
            return f"accessed {data_id}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "access", resource="Data:secrets", entities=['Data:secrets={"sensitive":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "access")(access_sensitive)

        with self.assertRaises(RilApprovalRequiredError) as ctx:
            governed("secrets")

        self.assertEqual(ctx.exception.verdict, "ask")
        self.assertEqual(ctx.exception.action, "access")
        self.assertFalse(self.executed, "wrapped function should NOT have executed")

    def test_sync_ask_with_on_ask_false_raises_approval_required(self):
        """ask tool with on_ask returning False raises RilApprovalRequiredError and side-effect never runs."""

        def access_sensitive(data_id):
            self.executed = True
            return f"accessed {data_id}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "access", resource="Data:secrets", entities=['Data:secrets={"sensitive":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "access", on_ask=lambda d, a: False)(access_sensitive)

        with self.assertRaises(RilApprovalRequiredError):
            governed("secrets")

        self.assertFalse(self.executed, "wrapped function should NOT have executed")

    def test_sync_ask_with_on_ask_true_executes(self):
        """ask tool with on_ask returning True executes and returns result."""

        def access_sensitive(data_id):
            self.executed = True
            return f"accessed {data_id}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "access", resource="Data:secrets", entities=['Data:secrets={"sensitive":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "access", on_ask=lambda d, a: True)(access_sensitive)

        result = governed("secrets")
        self.assertEqual(result, "accessed secrets")
        self.assertTrue(self.executed, "wrapped function should have executed")

    def test_async_ask_with_async_on_ask_true_executes(self):
        """ask tool with async on_ask returning True executes and returns result."""

        async def access_sensitive_async(data_id):
            self.executed = True
            await asyncio.sleep(0.001)
            return f"accessed {data_id}"

        async def async_on_ask(decision, args):
            await asyncio.sleep(0.001)
            return True

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "access", resource="Data:secrets", entities=['Data:secrets={"sensitive":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "access", on_ask=async_on_ask)(access_sensitive_async)

        result = asyncio.run(governed("secrets"))
        self.assertEqual(result, "accessed secrets")
        self.assertTrue(self.executed, "wrapped function should have executed")

    def test_sync_on_decision_callback_receives_decision(self):
        """on_decision callback receives the allow decision."""

        def read_safe_file(filename):
            return f"contents of {filename}"

        def on_decision_callback(decision, args):
            self.decision_received = decision

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "read", resource="File:test.txt", entities=['File:test.txt={"safe":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "read", on_decision=on_decision_callback)(read_safe_file)
        governed("test.txt")

        self.assertIsNotNone(self.decision_received)
        self.assertEqual(self.decision_received["verdict"], "allow")

    def test_async_on_decision_callback_receives_decision(self):
        """async on_decision callback receives the allow decision."""

        async def read_safe_file_async(filename):
            await asyncio.sleep(0.001)
            return f"contents of {filename}"

        async def async_on_decision_callback(decision, args):
            await asyncio.sleep(0.001)
            self.decision_received = decision

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "read", resource="File:test.txt", entities=['File:test.txt={"safe":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        governed = ril_govern(client, LAW_FILE, "read", on_decision=async_on_decision_callback)(
            read_safe_file_async
        )
        asyncio.run(governed("test.txt"))

        self.assertIsNotNone(self.decision_received)
        self.assertEqual(self.decision_received["verdict"], "allow")

    def test_ril_tool_guard_wrap_single_function(self):
        """RilToolGuard.wrap governs a single tool."""

        def read_file(filename):
            self.executed = True
            return f"read {filename}"

        def eval_override(law_file, action, **kwargs):
            return self.ril.evaluate(
                law_file, "read", resource="File:test.txt", entities=['File:test.txt={"safe":true}']
            )

        client = make_client_with_evaluate(self.ril, eval_override)
        guard = RilToolGuard(client, LAW_FILE)
        governed = guard.wrap(read_file, action="read")

        result = governed("test.txt")
        self.assertEqual(result, "read test.txt")
        self.assertTrue(self.executed)

    def test_ril_tool_guard_wrap_all(self):
        """RilToolGuard.wrap_all governs a multi-tool dict cleanly."""
        read_executed = False
        write_executed = False

        def read_file(filename):
            nonlocal read_executed
            read_executed = True
            return f"read {filename}"

        def write_file(filename, content):
            nonlocal write_executed
            write_executed = True
            return f"wrote {content} to {filename}"

        tools = {"read_file": read_file, "write_file": write_file}

        def eval_override(law_file, action, **kwargs):
            if action == "tools.read_file":
                return self.ril.evaluate(
                    law_file, "read", resource="File:test.txt", entities=['File:test.txt={"safe":true}']
                )
            elif action == "tools.write_file":
                return self.ril.evaluate(
                    law_file, "write", resource="File:danger.sh", entities=['File:danger.sh={"dangerous":true}']
                )
            return {"verdict": "deny", "laws": [], "errors": {}, "law_set_digest": ""}

        client = make_client_with_evaluate(self.ril, eval_override)
        guard = RilToolGuard(client, LAW_FILE, action_prefix="tools")
        governed = guard.wrap_all(tools)

        # Allow action should work
        result = governed["read_file"]("test.txt")
        self.assertEqual(result, "read test.txt")
        self.assertTrue(read_executed)

        # Deny action should raise
        with self.assertRaises(RilDeniedError):
            governed["write_file"]("danger.sh", "bad")

        self.assertFalse(write_executed, "write should not have executed")


if __name__ == "__main__":
    unittest.main()
