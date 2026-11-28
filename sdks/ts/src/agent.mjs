// @retvest/ril agent middleware — zero-dependency AI tool governance.
import { RilError } from "./index.mjs";

export class RilDeniedError extends Error {
  constructor(verdict, action, reason, matchedLaw, decision) {
    super(`Action "${action}" was denied by RIL: ${reason}`);
    this.name = "RilDeniedError";
    this.verdict = verdict;
    this.action = action;
    this.reason = reason;
    this.matchedLaw = matchedLaw;
    this.decision = decision;
  }
}

export class RilApprovalRequiredError extends Error {
  constructor(verdict, action, reason, matchedLaw, decision) {
    super(`Action "${action}" requires approval: ${reason}`);
    this.name = "RilApprovalRequiredError";
    this.verdict = verdict;
    this.action = action;
    this.reason = reason;
    this.matchedLaw = matchedLaw;
    this.decision = decision;
  }
}

/**
 * Wraps a function with RIL governance. Before calling the function, evaluates
 * the action against the law file. Only executes if allowed or approved.
 *
 * @param {Function} fn - The function to govern
 * @param {Object} options - Governance options
 * @param {import("./index.mjs").RilClient} options.client - RIL client instance
 * @param {string} options.lawFile - Path to the .ril law file
 * @param {string} options.action - Action name to evaluate
 * @param {string} [options.actor] - Principal actor (defaults to Agent:ai)
 * @param {Function} [options.mapContext] - Maps function args to context object
 * @param {Function} [options.onAsk] - Called when verdict is "ask"; returns boolean or Promise<boolean>
 * @param {Function} [options.onDecision] - Called with decision after evaluation
 * @returns {Function} - Governed wrapper function
 */
export function governTool(fn, options) {
  const { client, lawFile, action, actor, mapContext, onAsk, onDecision } = options;

  return async function (...args) {
    const context = mapContext ? mapContext(...args) : {};

    // Evaluate the action
    const decision = await client.evaluate(lawFile, action, {
      actor,
      context,
    });

    // Invoke onDecision callback if provided
    if (onDecision) {
      await onDecision(decision, args);
    }

    const verdict = decision.verdict;
    const reason = decision.laws.length > 0 ? `matched law(s): ${decision.laws.join(", ")}` : "no matching laws";
    const matchedLaw = decision.laws[0] || null;

    if (verdict === "allow") {
      const result = fn(...args);
      return result instanceof Promise ? await result : result;
    }

    if (verdict === "deny") {
      throw new RilDeniedError(verdict, action, reason, matchedLaw, decision);
    }

    // "hold" is RIL's verdict for "ask"
    if (verdict === "hold") {
      if (onAsk) {
        const approval = onAsk(decision, args);
        const approved = approval instanceof Promise ? await approval : approval;
        if (approved) {
          const result = fn(...args);
          return result instanceof Promise ? await result : result;
        }
      }
      throw new RilApprovalRequiredError("ask", action, reason, matchedLaw, decision);
    }

    throw new RilError(`Unknown verdict: ${verdict}`, decision);
  };
}

/**
 * Wraps a dictionary of tools with RIL governance.
 *
 * @param {Object} tools - Map of tool names to functions or {execute, ...} objects
 * @param {Object} options - Governance options
 * @param {import("./index.mjs").RilClient} options.client - RIL client instance
 * @param {string} options.lawFile - Path to the .ril law file
 * @param {string} [options.actionPrefix] - Prefix for action names (e.g., "tools")
 * @param {Object} [options.actionMap] - Map of tool names to action names
 * @param {string} [options.actor] - Principal actor (defaults to Agent:ai)
 * @param {Function} [options.onAsk] - Called when verdict is "ask"
 * @param {Function} [options.onDecision] - Called with decision after evaluation
 * @returns {Object} - New map of governed tools
 */
export function wrapTools(tools, options) {
  const { actionPrefix, actionMap = {} } = options;
  const wrapped = {};

  for (const [name, tool] of Object.entries(tools)) {
    const action = actionMap[name] || (actionPrefix ? `${actionPrefix}.${name}` : name);

    // Check if this is a plain function or an object with execute
    if (typeof tool === "function") {
      // Plain function (OpenAI / Anthropic style)
      wrapped[name] = governTool(tool, { ...options, action });
    } else if (tool && typeof tool.execute === "function") {
      // Vercel AI SDK / LangChain style: { description?, parameters?, execute(args) }
      wrapped[name] = {
        ...tool,
        execute: governTool(tool.execute, { ...options, action }),
      };
    } else {
      throw new TypeError(`Tool "${name}" must be a function or have an execute method`);
    }
  }

  return wrapped;
}
