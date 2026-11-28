import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RilClient, RilDeniedError, RilApprovalRequiredError, governTool, wrapTools } from "../src/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bin = [
  process.env.RIL_BIN,
  join(root, "ril-core/target/debug/ril"),
  join(root, "ril-core/target/release/ril"),
].find((p) => p && existsSync(p));
const skip = bin ? false : "ril binary not built (cargo build --manifest-path ril-core/Cargo.toml)";
const ril = bin ? new RilClient({ bin }) : null;
const lawFile = join(root, "sdks/fixtures/agent-test.ril");

// Helper to create a custom client with evaluate override
function makeClientWithEvaluate(evaluateOverride) {
  const client = new RilClient({ bin });
  client.evaluate = evaluateOverride;
  return client;
}

test("governTool allows permitted actions and executes the function", { skip }, async () => {
  let executed = false;
  const readSafeFile = (filename) => {
    executed = true;
    return `contents of ${filename}`;
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "read", {
      resource: "File:test.txt",
      entities: ['File:test.txt={"safe":true}'],
    });
  });

  const governed = governTool(readSafeFile, {
    client,
    lawFile,
    action: "read",
  });

  const result = await governed("test.txt");
  assert.equal(result, "contents of test.txt");
  assert.equal(executed, true, "wrapped function should have executed");
});

test("governTool denies forbidden actions and prevents execution", { skip }, async () => {
  let executed = false;
  const writeDangerousFile = (filename, content) => {
    executed = true;
    return `wrote ${content} to ${filename}`;
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "write", {
      resource: "File:danger.sh",
      entities: ['File:danger.sh={"dangerous":true}'],
    });
  });

  const governed = governTool(writeDangerousFile, {
    client,
    lawFile,
    action: "write",
  });

  await assert.rejects(
    () => governed("danger.sh", "rm -rf /"),
    (err) => {
      assert.ok(err instanceof RilDeniedError);
      assert.equal(err.verdict, "deny");
      assert.equal(err.action, "write");
      assert.ok(err.matchedLaw);
      return true;
    }
  );

  assert.equal(executed, false, "wrapped function should NOT have executed");
});

test("governTool with ask verdict and no onAsk throws RilApprovalRequiredError", { skip }, async () => {
  let executed = false;
  const accessSensitive = (dataId) => {
    executed = true;
    return `accessed ${dataId}`;
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "access", {
      resource: "Data:secrets",
      entities: ['Data:secrets={"sensitive":true}'],
    });
  });

  const governed = governTool(accessSensitive, {
    client,
    lawFile,
    action: "access",
  });

  await assert.rejects(
    () => governed("secrets"),
    (err) => {
      assert.ok(err instanceof RilApprovalRequiredError);
      assert.equal(err.verdict, "ask");
      assert.equal(err.action, "access");
      return true;
    }
  );

  assert.equal(executed, false, "wrapped function should NOT have executed");
});

test("governTool with ask verdict and onAsk returning false denies execution", { skip }, async () => {
  let executed = false;
  const accessSensitive = (dataId) => {
    executed = true;
    return `accessed ${dataId}`;
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "access", {
      resource: "Data:secrets",
      entities: ['Data:secrets={"sensitive":true}'],
    });
  });

  const governed = governTool(accessSensitive, {
    client,
    lawFile,
    action: "access",
    onAsk: () => false,
  });

  await assert.rejects(() => governed("secrets"), RilApprovalRequiredError);

  assert.equal(executed, false, "wrapped function should NOT have executed");
});

test("governTool with ask verdict and onAsk returning true allows execution", { skip }, async () => {
  let executed = false;
  const accessSensitive = (dataId) => {
    executed = true;
    return `accessed ${dataId}`;
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "access", {
      resource: "Data:secrets",
      entities: ['Data:secrets={"sensitive":true}'],
    });
  });

  const governed = governTool(accessSensitive, {
    client,
    lawFile,
    action: "access",
    onAsk: () => true,
  });

  const result = await governed("secrets");
  assert.equal(result, "accessed secrets");
  assert.equal(executed, true, "wrapped function should have executed");
});

test("governTool with async onAsk returning true allows execution", { skip }, async () => {
  let executed = false;
  const accessSensitive = (dataId) => {
    executed = true;
    return `accessed ${dataId}`;
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "access", {
      resource: "Data:secrets",
      entities: ['Data:secrets={"sensitive":true}'],
    });
  });

  const governed = governTool(accessSensitive, {
    client,
    lawFile,
    action: "access",
    onAsk: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return true;
    },
  });

  const result = await governed("secrets");
  assert.equal(result, "accessed secrets");
  assert.equal(executed, true, "wrapped function should have executed");
});

test("governTool calls onDecision callback with decision", { skip }, async () => {
  let decisionReceived = null;
  const readSafeFile = (filename) => `contents of ${filename}`;

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "read", {
      resource: "File:test.txt",
      entities: ['File:test.txt={"safe":true}'],
    });
  });

  const governed = governTool(readSafeFile, {
    client,
    lawFile,
    action: "read",
    onDecision: (decision) => {
      decisionReceived = decision;
    },
  });

  await governed("test.txt");
  assert.ok(decisionReceived);
  assert.equal(decisionReceived.verdict, "allow");
});

test("wrapTools with plain functions governs all tools", { skip }, async () => {
  const tools = {
    readFile: (filename) => `read ${filename}`,
    writeFile: (filename, content) => `wrote ${content} to ${filename}`,
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    if (action === "tools.readFile") {
      return ril.evaluate(lawFile, "read", {
        resource: "File:test.txt",
        entities: ['File:test.txt={"safe":true}'],
      });
    } else if (action === "tools.writeFile") {
      return ril.evaluate(lawFile, "write", {
        resource: "File:danger.sh",
        entities: ['File:danger.sh={"dangerous":true}'],
      });
    }
    return { verdict: "deny", laws: [], errors: {}, lawSetDigest: "" };
  });

  const governed = wrapTools(tools, {
    client,
    lawFile,
    actionPrefix: "tools",
  });

  // Allow action should work
  const readResult = await governed.readFile("test.txt");
  assert.equal(readResult, "read test.txt");

  // Deny action should throw
  await assert.rejects(() => governed.writeFile("danger.sh", "bad"), RilDeniedError);
});

test("wrapTools with Vercel AI SDK style tools (execute method)", { skip }, async () => {
  const tools = {
    readTool: {
      description: "Read a file",
      parameters: { filename: "string" },
      execute: (args) => `read ${args.filename}`,
    },
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    return ril.evaluate(lawFile, "read", {
      resource: "File:test.txt",
      entities: ['File:test.txt={"safe":true}'],
    });
  });

  const governed = wrapTools(tools, {
    client,
    lawFile,
    actionPrefix: "ai",
  });

  assert.ok(governed.readTool.description);
  assert.ok(governed.readTool.execute);

  const result = await governed.readTool.execute({ filename: "test.txt" });
  assert.equal(result, "read test.txt");
});

test("wrapTools with actionMap overrides action names", { skip }, async () => {
  const tools = {
    myCustomTool: (arg) => `executed ${arg}`,
  };

  const client = makeClientWithEvaluate((lawFile, action) => {
    if (action === "read") {
      return ril.evaluate(lawFile, "read", {
        resource: "File:test.txt",
        entities: ['File:test.txt={"safe":true}'],
      });
    }
    return { verdict: "deny", laws: [], errors: {}, lawSetDigest: "" };
  });

  const governed = wrapTools(tools, {
    client,
    lawFile,
    actionMap: { myCustomTool: "read" },
  });

  const result = await governed.myCustomTool("test");
  assert.equal(result, "executed test");
});
