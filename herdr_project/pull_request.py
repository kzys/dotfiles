"""Watching the user's pull requests on GitHub and telling the user, and
the Herdr agent working on each one, when its checks, review or state
change."""

import json
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

from herdr_project import inbox
from herdr_project.herdr import pane_cwd
from herdr_project.inbox import Owner
from herdr_project.notes import project_name
from herdr_project.state import load_state, save_state

QUERY = """
query($q: String!, $open: String!) {
  open: search(query: $open, type: ISSUE, first: 50) { ...pullRequests }
  search(query: $q, type: ISSUE, first: 50) { ...pullRequests }
}

fragment pullRequests on SearchResultItemConnection {
    nodes {
      ... on PullRequest {
        number title url state isDraft headRefName reviewDecision
        repository { nameWithOwner }
        headRepository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup {
          state
          contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          } }
        } } } }
      }
    }
}
"""

# Check run conclusions and status states that count as failures.
FAILED = {"FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"}

MARKS = {"SUCCESS": "✓", "FAILURE": "✗", "ERROR": "✗", "PENDING": "…", "EXPECTED": "…"}

# How each check run conclusion or status state counts; anything else,
# such as a check run without a conclusion yet, is still running.
RUN_STATES = {**{s: "failed" for s in FAILED}, "SUCCESS": "passed", "NEUTRAL": "skipped",
              "SKIPPED": "skipped", "CANCELLED": "cancelled", "STALE": "cancelled"}


def runs(contexts):
    """Returns the checks in contexts, from a commit's status check
    rollup, as dicts with their name, state (passed, failed, running,
    skipped or cancelled) and url, or None, sorted by name."""
    return sorted(({"name": c.get("name") or c.get("context") or "?",
                    "state": RUN_STATES.get(c.get("conclusion") or c.get("state"), "running"),
                    "url": c.get("detailsUrl") or c.get("targetUrl")}
                   for c in contexts), key=lambda r: r["name"])


def search_query(since, orgs=(), only_open=False):
    """Returns the GitHub search for the user's pull requests updated
    since the date since, or only the open ones if only_open, most
    recently updated first, in any of orgs, or anywhere without orgs."""
    return " ".join(["is:pr author:@me archived:false", *(["is:open"] if only_open else []),
                     *(f"org:{o}" for o in orgs),
                     f"updated:>={since:%Y-%m-%d} sort:updated-desc"])


def fetch(command="gh", days=14, orgs=()):
    """Returns two searches for the user's pull requests updated in the
    last days days in any of orgs, or anywhere without orgs, each most
    recently updated first, as GitHub's GraphQL API returns them: open,
    the open ones, and search, all of them, including merged and closed
    ones, which may push the open ones out. Raises if gh fails, with its
    error rather than the query."""
    since = datetime.now().astimezone() - timedelta(days=days)
    run = subprocess.run(
        [command, "api", "graphql", "-f", f"query={QUERY}",
         "-f", f"q={search_query(since, orgs)}", "-f", f"open={search_query(since, orgs, only_open=True)}"],
        capture_output=True, text=True, check=False,
    )
    if run.returncode != 0:
        raise RuntimeError(run.stderr.strip() or f"gh exited with {run.returncode}")
    return json.loads(run.stdout)


def pull_requests(data):
    """Returns the pull requests in data, a response from fetch, as
    dicts with their url, repo ("owner/name"), the repo their branch is
    in (head, the same unless from a fork), number, title, branch,
    state (OPEN, MERGED or CLOSED), draft flag, checks (the rollup
    state, or None without checks), the names of failed checks, each
    check as runs returns them, and review decision. The open ones come
    first, each pull request once."""
    prs, seen = [], set()
    nodes = [n for part in ("open", "search")
             for n in (data["data"].get(part) or {}).get("nodes") or []]
    for node in nodes:
        if not node or node["url"] in seen:
            continue
        seen.add(node["url"])
        commits = (node.get("commits") or {}).get("nodes") or [{}]
        rollup = (commits[0].get("commit") or {}).get("statusCheckRollup") or {}
        contexts = (rollup.get("contexts") or {}).get("nodes") or []
        failed = sorted({
            c.get("name") or c.get("context") or "?" for c in contexts
            if (c.get("conclusion") or c.get("state")) in FAILED
        })
        prs.append({
            "url": node["url"],
            "repo": node["repository"]["nameWithOwner"],
            "head": (node.get("headRepository") or node["repository"])["nameWithOwner"],
            "number": node["number"],
            "title": node["title"],
            "branch": node["headRefName"],
            "state": node["state"],
            "draft": node["isDraft"],
            "checks": rollup.get("state"),
            "failed": failed,
            "runs": runs(contexts),
            "review": node.get("reviewDecision"),
        })
    return prs


def repo_name(url):
    """Returns the "owner/name" of the GitHub repository at remote url,
    or None if it isn't on GitHub."""
    m = re.match(r"(?:https://|ssh://git@|git@)github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$",
                 url.strip())
    return m.group(1) if m else None


def git(d, *args):
    """Returns what git with args prints in directory d, stripped, or ""
    if it fails or takes over 10 seconds, as on a stuck mount."""
    try:
        return subprocess.run(
            ["git", "-C", str(d), *args], stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, check=False, timeout=10,
        ).stdout.strip()
    except subprocess.TimeoutExpired:
        return ""


def checkout(d):
    """Returns the git checkout directory d is in as a dict with its
    branch and repo ("owner/name" of origin, or None), or None if it
    isn't in one or is on no branch."""
    branch = git(d, "branch", "--show-current")
    if not branch:
        return None
    return {"branch": branch, "repo": repo_name(git(d, "remote", "get-url", "origin"))}


def checkout_panes(panes, prs):
    """Returns the agent panes, from panes in herdr pane list's form, that
    work in a checkout of a pull request in prs on its branch, by the
    pull request's url, the first pane for each. The checkout's origin
    must be the repository the branch is in, so that a fork's branch
    doesn't match the upstream's branch of the same name."""
    found, seen = {}, {}
    for p in panes:
        d = pane_cwd(p)
        if not p.get("agent") or not d:
            continue
        if d not in seen:
            seen[d] = checkout(d)
        c = seen[d]
        for pr in prs if c else ():
            if c["branch"] == pr["branch"] and (c["repo"] or "").lower() == pr["head"].lower():
                found.setdefault(pr["url"], p)
    return found


def worktrees(root):
    """Returns the git checkouts directly in the projects under root as
    dicts with their project, dir, branch and repo ("owner/name" of
    origin, or None)."""
    trees = []
    for d in sorted(Path(root).glob("*/*/.git")):
        d = d.parent
        branch = git(d, "branch", "--show-current")
        if branch:
            trees.append({"project": str(d.parent), "dir": str(d), "branch": branch,
                          "repo": repo_name(git(d, "remote", "get-url", "origin"))})
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
    """Returns the project working on pr as an Owner with its project,
    the dir of the worktree on pr's branch or None, and the role whose
    notes mention pr or None. A worktree on the branch wins over notes.
    Returns None if no project is."""
    for t in trees:
        if t["branch"] == pr["branch"] and (t["repo"] or "").lower() == pr["repo"].lower():
            return Owner(t["project"], t["dir"])
    found = None
    for project, role, text in texts:
        # Prefer the latest project, and an agent's notes over README.md.
        if mentions(text, pr) and (found is None or project > found.project or (
                project == found.project and role)):
            found = Owner(project, role=role)
    return found


def agent_pane(panes, found):
    """Returns the Herdr pane, from panes in herdr pane list's form,
    of the agent working on the pr that Owner found describes, or None. That is the agent in the worktree, else the one with the
    role, else any agent in the project."""
    agents = [p for p in panes if p.get("agent")]

    def inside(path, d):
        return path == d or path.startswith(d.rstrip("/") + "/")

    in_project = [p for p in agents if inside(pane_cwd(p), found.project)]
    for p in in_project:
        if found.dir and inside(pane_cwd(p), found.dir):
            return p
    for p in in_project:
        if found.role and (p.get("tokens") or {}).get("role") == found.role:
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
            if pr["state"] == "OPEN" and pr["checks"] in FAILED:
                out.append((pr, failure(pr), True))
            continue
        if pr["state"] != before["state"]:
            out.append((pr, pr["state"].lower(), False))
            continue
        if pr["state"] != "OPEN":
            continue
        if pr["checks"] != before["checks"]:
            if pr["checks"] in FAILED:
                out.append((pr, failure(pr), True))
            elif pr["checks"] == "SUCCESS":
                out.append((pr, "checks passed", False))
        if pr["review"] != before["review"] and pr["review"] in (
                "APPROVED", "CHANGES_REQUESTED"):
            out.append((pr, pr["review"].lower().replace("_", " "), False))
    return out


def failure(pr):
    """Returns the message saying pr's checks failed."""
    return "checks failed" + (f": {', '.join(pr['failed'])}" if pr["failed"] else "")


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


def listed(prs, owners, panes_by_url, checkouts=None):
    """Returns the open pull requests in prs, those with projects first,
    as dicts with the fields pull_requests gives them, their label, the
    name of their project from owners (by url) or None, whether an agent
    pane works on them, and the id of the pane in their checkout, from
    checkouts (by url), or None. Only that pane surely works on them;
    others may be any agent in their project."""
    rows = []
    for pr in prs:
        if pr["state"] != "OPEN":
            continue
        found = owners.get(pr["url"])
        sure = (checkouts or {}).get(pr["url"])
        rows.append({**pr, "label": label(pr),
                     "project": project_name(found.project) if found else None,
                     "agent": bool(panes_by_url.get(pr["url"])),
                     "pane": sure["pane_id"] if sure else None})
    return sorted(rows, key=lambda r: r["project"] is None)


def table(rows):
    """Returns lines listing rows, the pull requests listed returns, with
    their checks, project and whether an agent pane works on them."""
    return [f"{MARKS.get(r['checks'], ' ')} {'●' if r['agent'] else ' '} {r['label']:<24} "
            f"{r['project'] or '':<20} {r['title']}{' (draft)' if r['draft'] else ''}"
            for r in rows]


def waiting_items(prs, owners):
    """Returns inbox items for the open pull requests in prs that wait on
    the user: those whose checks failed, that have changes requested, or
    that are approved with passing checks, with projects from owners."""
    items = []
    for pr in prs:
        if pr["state"] != "OPEN":
            continue
        if pr["checks"] in FAILED:
            message = failure(pr)
        elif pr["review"] == "CHANGES_REQUESTED":
            message = "changes requested"
        elif pr["review"] == "APPROVED" and pr["checks"] in ("SUCCESS", None) and not pr["draft"]:
            message = "approved, ready to merge"
        else:
            continue
        items.append(inbox.item(owners.get(pr["url"]), "pr",
                                f"{label(pr)} {message}: {pr['title']}"))
    return items


def poll(herdr, root, path, gh="gh", orgs=()):
    """Checks the pull requests once: tells the user and their agents
    about changes since the state in path, saves the new state there,
    and returns the lines of table, the projects of the pull requests
    by url, the inbox items of waiting_items, and the pull requests as
    listed returns them. herdr runs a herdr command and returns its parsed output.
    The projects are under root. Only pull requests in orgs count, or
    all without orgs."""
    old = load_state(path)
    prs = pull_requests(fetch(gh, orgs=orgs))
    trees, texts = worktrees(root), notes_texts(root)
    panes = herdr("pane", "list")["result"]["panes"]
    owners = {pr["url"]: owner(pr, trees, texts) for pr in prs}
    # An agent in a checkout on the branch, wherever it is, surely works
    # on the pull request; one in its project only may.
    open_prs = [pr for pr in prs if pr["state"] == "OPEN"]
    panes_by_url = {url: agent_pane(panes, f) for url, f in owners.items() if f}
    checkouts = checkout_panes(panes, open_prs)
    panes_by_url.update(checkouts)
    for pr, message, wake in events(old, prs):
        found = owners.get(pr["url"])
        where = f" ({Path(found.project).name})" if found else ""
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
    save_state(path, remember(old, prs))
    rows = listed(prs, owners, panes_by_url, checkouts)
    return table(rows), owners, waiting_items(prs, owners), rows

