#!/bin/sh
# Zero-database Claude Code PreToolUse hook powered by RIL v0.2.1.
# Wire in .claude/settings.json under hooks.PreToolUse -> command: "./examples/claude-code-mcp/pre-tool-use.sh"
set -eu

LAWS_FILE="${RIL_LAWS_FILE:-laws.ril}"
PAYLOAD=$(cat)

TOOL_NAME=$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_name",""))')
COMMAND=$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("command",""))')
FILE_PATH=$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path", d.get("path","")))')

if [ "$TOOL_NAME" = "Bash" ]; then
  CTX=$(python3 -c 'import json,sys; print(json.dumps({"command":sys.argv[1],"workspace":"local"}))' "$COMMAND")
  set +e
  OUT=$(ril laws eval "$LAWS_FILE" --action exec --resource ShellCommand:bash --principal Agent:claude-code --context "$CTX" 2>&1)
  CODE=$?
  set -e
elif [ "$TOOL_NAME" = "Read" ] || [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "Write" ]; then
  CTX=$(python3 -c 'import json,sys; print(json.dumps({"path":sys.argv[1],"workspace":"local"}))' "$FILE_PATH")
  set +e
  OUT=$(ril laws eval "$LAWS_FILE" --action read --resource File:workspace --principal Agent:claude-code --context "$CTX" 2>&1)
  CODE=$?
  set -e
else
  exit 0
fi

case "$CODE" in
  0)
    exit 0
    ;;
  2)
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"RIL: %s"}}\n' "$OUT"
    exit 0
    ;;
  *)
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"RIL blocked action: %s"}}\n' "$OUT"
    exit 0
    ;;
esac
