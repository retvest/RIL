"""AI Agent Framework Middleware — zero-dependency governance for AI tool calls."""
from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, TypeVar, cast

from .client import RilClient

F = TypeVar("F", bound=Callable[..., Any])


class RilDeniedError(Exception):
    """Raised when an action is denied by RIL governance."""

    def __init__(
        self,
        verdict: str,
        action: str,
        reason: str,
        matched_law: str | None,
        decision: dict[str, Any],
    ):
        super().__init__(f'Action "{action}" was denied by RIL: {reason}')
        self.verdict = verdict
        self.action = action
        self.reason = reason
        self.matched_law = matched_law
        self.decision = decision


class RilApprovalRequiredError(Exception):
    """Raised when an action requires approval."""

    def __init__(
        self,
        verdict: str,
        action: str,
        reason: str,
        matched_law: str | None,
        decision: dict[str, Any],
    ):
        super().__init__(f'Action "{action}" requires approval: {reason}')
        self.verdict = verdict
        self.action = action
        self.reason = reason
        self.matched_law = matched_law
        self.decision = decision


def ril_govern(
    client: RilClient,
    law_file: str,
    action: str,
    *,
    actor: str | None = None,
    map_context: Callable[..., dict[str, Any]] | None = None,
    on_ask: Callable[[dict[str, Any], tuple[Any, ...]], bool] | None = None,
    on_decision: Callable[[dict[str, Any], tuple[Any, ...]], None] | None = None,
) -> Callable[[F], F]:
    """
    Decorator to govern a function with RIL. Works on both sync and async functions.

    Args:
        client: RIL client instance
        law_file: Path to the .ril law file
        action: Action name to evaluate
        actor: Principal actor (defaults to Agent:ai)
        map_context: Maps function args to context dict
        on_ask: Called when verdict is "ask"; returns bool (sync or async)
        on_decision: Called with decision after evaluation (sync or async)

    Example:
        @ril_govern(client, "laws.ril", "execute_code")
        def run_code(code: str):
            exec(code)
    """

    def decorator(fn: F) -> F:
        is_async = inspect.iscoroutinefunction(fn)

        if is_async:

            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                context = map_context(*args, **kwargs) if map_context else {}

                # Evaluate the action
                decision = client.evaluate(
                    law_file,
                    action,
                    actor=actor or "Agent:ai",
                    context=context,
                )

                # Invoke onDecision callback if provided
                if on_decision:
                    result = on_decision(decision, args)
                    if inspect.iscoroutine(result):
                        await result

                verdict = decision["verdict"]
                laws = decision.get("laws", [])
                reason = f"matched law(s): {', '.join(laws)}" if laws else "no matching laws"
                matched_law = laws[0] if laws else None

                if verdict == "allow":
                    return await fn(*args, **kwargs)

                if verdict == "deny":
                    raise RilDeniedError(verdict, action, reason, matched_law, decision)

                # "hold" is RIL's verdict for "ask"
                if verdict == "hold":
                    if on_ask:
                        approval = on_ask(decision, args)
                        if inspect.iscoroutine(approval):
                            approval = await approval
                        if approval:
                            return await fn(*args, **kwargs)
                    raise RilApprovalRequiredError("ask", action, reason, matched_law, decision)

                raise ValueError(f"Unknown verdict: {verdict}")

            return cast(F, async_wrapper)
        else:

            @functools.wraps(fn)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                context = map_context(*args, **kwargs) if map_context else {}

                # Evaluate the action
                decision = client.evaluate(
                    law_file,
                    action,
                    actor=actor or "Agent:ai",
                    context=context,
                )

                # Invoke onDecision callback if provided
                if on_decision:
                    result = on_decision(decision, args)
                    if inspect.iscoroutine(result):
                        raise TypeError("on_decision returned a coroutine but function is not async")

                verdict = decision["verdict"]
                laws = decision.get("laws", [])
                reason = f"matched law(s): {', '.join(laws)}" if laws else "no matching laws"
                matched_law = laws[0] if laws else None

                if verdict == "allow":
                    return fn(*args, **kwargs)

                if verdict == "deny":
                    raise RilDeniedError(verdict, action, reason, matched_law, decision)

                # "hold" is RIL's verdict for "ask"
                if verdict == "hold":
                    if on_ask:
                        approval = on_ask(decision, args)
                        if inspect.iscoroutine(approval):
                            raise TypeError("on_ask returned a coroutine but function is not async")
                        if approval:
                            return fn(*args, **kwargs)
                    raise RilApprovalRequiredError("ask", action, reason, matched_law, decision)

                raise ValueError(f"Unknown verdict: {verdict}")

            return cast(F, sync_wrapper)

    return decorator


class RilToolGuard:
    """
    Helper for governing multiple tools with RIL.

    Example:
        guard = RilToolGuard(client, "laws.ril", action_prefix="tools")
        tools = {
            "read_file": read_file,
            "write_file": write_file,
        }
        governed_tools = guard.wrap_all(tools)
    """

    def __init__(
        self,
        client: RilClient,
        law_file: str,
        *,
        actor: str | None = None,
        action_prefix: str | None = None,
        on_ask: Callable[[dict[str, Any], tuple[Any, ...]], bool] | None = None,
        on_decision: Callable[[dict[str, Any], tuple[Any, ...]], None] | None = None,
    ):
        self.client = client
        self.law_file = law_file
        self.actor = actor
        self.action_prefix = action_prefix
        self.on_ask = on_ask
        self.on_decision = on_decision

    def wrap(
        self,
        fn: F,
        action: str | None = None,
        map_context: Callable[..., dict[str, Any]] | None = None,
    ) -> F:
        """Wrap a single function with RIL governance."""
        if action is None:
            action = fn.__name__
        return ril_govern(
            self.client,
            self.law_file,
            action,
            actor=self.actor,
            map_context=map_context,
            on_ask=self.on_ask,
            on_decision=self.on_decision,
        )(fn)

    def wrap_all(self, tools: dict[str, Callable[..., Any]]) -> dict[str, Callable[..., Any]]:
        """Wrap a dictionary of tools with RIL governance."""
        wrapped = {}
        for name, fn in tools.items():
            action = f"{self.action_prefix}.{name}" if self.action_prefix else name
            wrapped[name] = self.wrap(fn, action=action)
        return wrapped
