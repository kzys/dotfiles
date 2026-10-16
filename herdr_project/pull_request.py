"""Watching the user's pull requests on GitHub and telling the user, and
the Herdr agent working on each one, when its checks, review or state
change."""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from herdr_project.notes import front_matter

QUERY = """
query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url state isDraft headRefName reviewDecision
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup {
          state
          contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name conclusion }
            ... on StatusContext { context state }
          } }
        } } } }
      }
    }
  }
}
"""

# Check run conclusions and status states that count as failures.
FAILED = {"FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"}

MARKS = {"SUCCESS": "✓", "FAILURE": "✗", "ERROR": "✗", "PENDING": "…", "EXPECTED": "…"}


def search_query(since, orgs=()):
    """Returns the GitHub search for the user's pull requests updated
    since the date since, most recently updated first, in any of orgs,
    or anywhere without orgs."""
    return " ".join(["is:pr author:@me archived:false", *(f"org:{o}" for o in orgs),
                     f"updated:>={since:%Y-%m-%d} sort:updated-desc"])


def fetch(command="gh", days=14, orgs=()):
    """Returns the user's pull requests updated in the last days days in
    any of orgs, or anywhere without orgs, most recently updated first,
    including merged and closed ones, as GitHub's GraphQL API returns
    them. Raises if gh fails."""
    since = datetime.now() - timedelta(days=days)
    out = subprocess.run(
        [command, "api", "graphql", "-f", f"query={QUERY}",
         "-f", f"q={search_query(since, orgs)}"],
        stdout=subprocess.PIPE, text=True, check=True,
    ).stdout
    return json.loads(out)


def pull_requests(data):
    """Returns the pull requests in data, a response from fetch, as
    dicts with their url, repo ("owner/name"), number, title, branch,
    state (OPEN, MERGED or CLOSED), draft flag, checks (the rollup
    state, or None without checks), the names of failed checks, and
    review decision."""
    prs = []
    for node in data["data"]["search"]["nodes"]:
        if not node:
            continue
        commits = (node.get("commits") or {}).get("nodes") or [{}]
        rollup = (commits[0].get("commit") or {}).get("statusCheckRollup") or {}
        contexts = (rollup.get("contexts") or {}).get("nodes") or []
        failed = sorted({
            c.get("name") or c.get("context") for c in contexts
            if (c.get("conclusion") or c.get("state")) in FAILED
        })
        prs.append({
            "url": node["url"],
            "repo": node["repository"]["nameWithOwner"],
            "number": node["number"],
            "title": node["title"],
            "branch": node["headRefName"],
            "state": node["state"],
            "draft": node["isDraft"],
            "checks": rollup.get("state"),
            "failed": failed,
            "review": node.get("reviewDecision"),
        })
    return prs


def repo_name(url):
    """Returns the "owner/name" of the GitHub repository at remote url,
    or None if it isn't on GitHub."""
    m = re.match(r"(?:https://|ssh://git@|git@)github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$",
                 url.strip())
    return m.group(1) if m else None


def worktrees(root):
    """Returns the git checkouts directly in the projects under root as
    dicts with their project, dir, branch and repo ("owner/name" of
    origin, or None)."""
    trees = []
    for d in sorted(Path(root).glob("*/*/.git")):
        d = d.parent

        def git(*args):
            return subprocess.run(
                ["git", "-C", str(d), *args], stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, check=False,
            ).stdout.strip()

        branch = git("branch", "--show-current")
        if branch:
            trees.append({"project": str(d.parent), "dir": str(d), "branch": branch,
                          "repo": repo_name(git("remote", "get-url", "origin"))})
    return trees


def notes_texts(root):
    """Returns the notes of the projects under root as (project, role,
    text) tuples, where role is None for README.md."""
    texts = []
    for f in sorted(Path(root).glob("*/*.md")):
        if f.name == "README.md":
            role = None
        elif f.name.startswith("AGENT-"):
            role = f.stem[len("AGENT-"):]
        else:
            continue
        try:
            texts.append((str(f.parent), role, f.read_text(errors="replace")))
        except OSError:
            pass
    return texts


def mentions(text, pr):
    """Reports whether text mentions pr by its url, as owner/name#N or
    as name#N."""
    name = pr["repo"].split("/")[1]
    pattern = (rf"{re.escape(pr['url'])}(?!\d)"
               rf"|(?<![\w.-])(?:{re.escape(pr['repo'])}|{re.escape(name)})#{pr['number']}(?!\d)")
    return re.search(pattern, text) is not None


def owner(pr, trees, texts):
    """Returns the project working on pr as a dict with its project,
    the dir of the worktree on pr's branch or None, and the role whose
    notes mention pr or None. A worktree on the branch wins over notes.
    Returns None if no project is."""
    for t in trees:
        if t["branch"] == pr["branch"] and t["repo"] in (pr["repo"], None):
            return {"project": t["project"], "dir": t["dir"], "role": None}
    found = None
    for project, role, text in texts:
        if mentions(text, pr):
            # Prefer the latest project, and an agent's notes over README.md.
            if found is None or project > found["project"] or (
                    project == found["project"] and role):
                found = {"project": project, "dir": None, "role": role}
    return found


def agent_pane(panes, found):
    """Returns the Herdr pane, from panes in herdr pane list's form,
    of the agent working on the pr that found, from owner, describes,
    or None. That is the agent in the worktree, else the one with the
    role, else any agent in the project."""
    agents = [p for p in panes if p.get("agent")]

    def cwd(p):
        return (p.get("tokens") or {}).get("cwd") or p.get("cwd") or ""

    def inside(path, d):
        return path == d or path.startswith(d.rstrip("/") + "/")

    in_project = [p for p in agents if inside(cwd(p), found["project"])]
    for p in in_project:
        if found["dir"] and inside(cwd(p), found["dir"]):
            return p
    for p in in_project:
        if found["role"] and (p.get("tokens") or {}).get("role") == found["role"]:
            return p
    return in_project[0] if in_project else None


def label(pr):
    """Returns pr's short name, like name#N."""
    return f"{pr['repo'].split('/')[1]}#{pr['number']}"


def events(old, prs):
    """Returns what changed in prs since old, the state that remember
    returned last time, as (pr, message, wake) tuples, where wake says
    whether the agent working on pr should act on it. With no old state
    nothing has changed. A pull request seen for the first time counts
    as changed if its checks failed."""
    if old is None:
        return []
    out = []
    for pr in prs:
        before = old.get(pr["url"])
        if before is None:
            if pr["state"] == "OPEN" and pr["checks"] == "FAILURE":
                out.append((pr, f"checks failed: {', '.join(pr['failed'])}", True))
            continue
        if pr["state"] != before["state"]:
            out.append((pr, pr["state"].lower(), False))
            continue
        if pr["state"] != "OPEN":
            continue
        if pr["checks"] != before["checks"]:
            if pr["checks"] == "FAILURE":
                out.append((pr, f"checks failed: {', '.join(pr['failed'])}", True))
            elif pr["checks"] == "SUCCESS":
                out.append((pr, "checks passed", False))
        if pr["review"] != before["review"] and pr["review"] in (
                "APPROVED", "CHANGES_REQUESTED"):
            out.append((pr, pr["review"].lower().replace("_", " "), False))
    return out


def remember(old, prs):
    """Returns the state to compare the next prs with: old updated with
    prs, without pull requests that are no longer open."""
    state = dict(old or {})
    for pr in prs:
        state[pr["url"]] = {k: pr[k] for k in ("state", "checks", "review")}
    return {url: s for url, s in state.items() if s["state"] == "OPEN"}


def wake_message(pr, message):
    """Returns what to tell the agent working on pr about message."""
    return (f"{pr['url']} {message}. Look into it, fix it if it is caused "
            f"by the change, and update your notes.")


def table(prs, owners, panes_by_url):
    """Returns lines listing the open pull requests in prs with their
    checks, project name from owners (by url) and whether an agent
    pane works on them, those with projects first."""
    rows = []
    for pr in prs:
        if pr["state"] != "OPEN":
            continue
        found = owners.get(pr["url"])
        name = ""
        if found:
            name = front_matter(found["project"], "name") or Path(found["project"]).name
        mark = MARKS.get(pr["checks"], " ")
        agent = "●" if panes_by_url.get(pr["url"]) else " "
        draft = " (draft)" if pr["draft"] else ""
        rows.append((found is None, f"{mark} {agent} {label(pr):<24} {name:<20} "
                                    f"{pr['title']}{draft}"))
    return [r for _, r in sorted(rows, key=lambda r: r[0])]


def state_file(env):
    """Returns the file that keeps the state of the pull requests,
    under $XDG_STATE_HOME from env, by default ~/.local/state."""
    state = env.get("XDG_STATE_HOME") or Path(env["HOME"]) / ".local/state"
    return Path(state) / "herdr-project/pull-requests.json"


def poll(herdr, root, path, gh="gh", orgs=()):
    """Checks the pull requests once: tells the user and their agents
    about changes since the state in path, saves the new state there,
    and returns the lines of table. herdr runs a herdr command and
    returns its parsed output. The projects are under root. Only pull
requests in orgs count, or all without orgs."""
    try:
        old = json.loads(path.read_text())
    except (OSError, ValueError):
        old = None
    prs = pull_requests(fetch(gh, orgs=orgs))
    trees, texts = worktrees(root), notes_texts(root)
    panes = herdr("pane", "list")["result"]["panes"]
    owners = {pr["url"]: owner(pr, trees, texts) for pr in prs}
    panes_by_url = {url: agent_pane(panes, f) for url, f in owners.items() if f}
    for pr, message, wake in events(old, prs):
        found = owners.get(pr["url"])
        where = f" ({Path(found['project']).name})" if found else ""
        try:
            herdr("notification", "show", f"{label(pr)} {message}",
                  "--body", f"{pr['title']}{where}",
                  "--sound", "request" if wake else "done")
        except (OSError, subprocess.CalledProcessError):
            pass
        pane = panes_by_url.get(pr["url"])
        if wake and pane and pane.get("agent_status") in ("idle", "done"):
            try:
                herdr("pane", "run", pane["pane_id"], wake_message(pr, message))
            except (OSError, subprocess.CalledProcessError):
                pass
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(remember(old, prs), indent=1))
    return table(prs, owners, panes_by_url)


def watch(herdr, root, path, orgs=(), interval=120):
    """Polls the pull requests in orgs, or all without orgs, every
    interval seconds, printing the table, until interrupted. Failures show instead of the table."""
    while True:
        try:
            lines = poll(herdr, root, path, orgs=orgs)
        except (OSError, ValueError, KeyError, TypeError,
                subprocess.CalledProcessError) as e:
            lines = [f"Cannot check pull requests: {e!r}"]
        stamp = datetime.now().strftime("%H:%M")
        sys.stdout.write("\033[H\033[2J" + f"Pull requests at {stamp}\n" + "\n".join(lines))
        sys.stdout.flush()
        time.sleep(interval)


def main(herdr, orgs=()):
    """Watches the pull requests in orgs, or all without orgs, of the
    projects under ~/project."""
    try:
        watch(herdr, Path.home() / "project", state_file(os.environ), orgs)
    except KeyboardInterrupt:
        pass
    return 0
