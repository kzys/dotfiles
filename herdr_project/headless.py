"""Asking a headless Claude session, which has the user's claude.ai
connectors, for structured data."""

import json
import subprocess


def ask(state_dir, prompt, schema, tools, field, command="claude"):
    """Returns field of the output, matching schema, of a headless Claude
    session in state_dir that may only use tools to answer prompt.
    Raises if it fails."""
    out = subprocess.run(
        [command, "-p", "--no-session-persistence", "--model", "sonnet",
         "--output-format", "json", "--max-budget-usd", "2",
         "--json-schema", json.dumps(schema), "--allowedTools", *tools,
         "--", prompt],
        cwd=state_dir, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, check=True, timeout=900,
    ).stdout
    return structured(json.loads(out), field)


def structured(result, field):
    """Returns field of the structured output in result, the JSON output
    of claude -p. Raises ValueError if Claude didn't produce it."""
    found = (result.get("structured_output") or {}).get(field)
    if result.get("is_error") or found is None:
        raise ValueError(result.get("result") or f"no {field}")
    return found
