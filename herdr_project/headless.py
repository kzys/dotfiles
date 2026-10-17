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


def connected(listing):
    """Returns the names of the claude.ai connectors that listing, the
    output of claude mcp list, shows as connected, like Slack."""
    names = set()
    for line in listing.splitlines():
        head, sep, status = line.rpartition(" - ")
        if line.startswith("claude.ai ") and sep and "Connected" in status:
            names.add(head[len("claude.ai "):].split(":", 1)[0])
    return names


def connectors(command="claude"):
    """Returns the names of the user's connected claude.ai connectors,
    as claude mcp list shows them, or None if it fails."""
    try:
        listing = subprocess.run(
            [command, "mcp", "list"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, check=True, timeout=120,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return connected(listing)


def structured(result, field):
    """Returns field of the structured output in result, the JSON output
    of claude -p. Raises ValueError if Claude didn't produce it."""
    found = (result.get("structured_output") or {}).get(field)
    if result.get("is_error") or found is None:
        raise ValueError(result.get("result") or f"no {field}")
    return found
