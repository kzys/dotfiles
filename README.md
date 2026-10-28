# dotfiles

This is my configuration files from day-to-day computers to
[GitHub Codespaces](https://docs.github.com/en/codespaces/setting-your-user-preferences/personalizing-github-codespaces-for-your-account).

```
./install.sh
ansible-playbook user.yml
sudo ansible-playbook root.yml
```

`install.sh` links dotfiles into place, so edits apply right away. The
playbooks copy `files/` and set up services and packages, so rerun them
after changing anything there.

## Atlassian keep-alive

Jira/Confluence Cloud accounts get deactivated from inactivity. `atlassian_keepalive.py`
pings both APIs daily via a systemd user timer (`atlassian-keepalive.service`/`.timer`),
set up by `user.yml`.

Credentials are kept **out of this repo**, in `~/.config/atlassian-keepalive.env`
(mode 600, plain `VAR=value` lines):

```
ATLASSIAN_DOMAIN=mycompany       # subdomain only, e.g. "mycompany" for mycompany.atlassian.net
ATLASSIAN_EMAIL=you@example.com
ATLASSIAN_API_TOKEN=...          # from https://id.atlassian.com/manage-profile/security/api-tokens
```

`user.yml` enables the timer only when this file exists, so rerun it after
creating the file.

Manual run / check status:

```bash
systemctl --user start atlassian-keepalive.service
journalctl --user -u atlassian-keepalive.service -n 20
systemctl --user list-timers atlassian-keepalive.timer
```

On servers/headless machines, run `loginctl enable-linger $USER` so the user timer
fires without an active login session.

## Herdr agent selection

Choose an agent explicitly; Claude is the default:

```sh
hp --agent codex
hp --agent codex --resume <session-id>
herdr-project-picker
herdr-adopt --agent codex
cdc --agent codex
```

The picker and prefix+w shortcut list Claude and Codex sessions together,
newest first, labeled with their agent. Selecting a saved session resumes it
with its own agent; selecting a running session focuses its pane. New projects
have separate Claude and Codex choices. Selecting a project asks which agent
to start. The inbox picker also resolves items across both agents.
Other `hp` arguments pass through to the selected agent. Use `--` before
arguments that should bypass `hp`'s parser.

Run `./install_codex.py` (Python 3.11+) once to install Herdr's Codex session integration and
sidebar metadata hooks; `install.sh` also does this when both CLIs are available.
In Codex, use `/hooks` to review and trust the installed hooks. Hooks report the
session identity, prompt, directory, branch, model, and context usage when available.
The picker reads Codex's local session database (including paginated sessions),
with a rollout fallback for older installations. Codex context percentages are
available for legacy rollouts; newer paginated history may leave that field blank.
`herdr-adopt` selects saved Codex sessions to resume, or Claude background sessions.

Both agents receive the same project notes instructions and house rules. Claude
keeps its existing settings; Codex uses its configured model and approval policy.

`codex/config.toml` holds reusable Codex preferences. The installer merges them
into `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), preserving app settings
and local state. Run `./install_codex.py --config-only` to apply just preferences.
Auto-review handles approval requests with a reviewer agent; workspace writes
stay sandboxed. Restart Codex to load the preferences.

## herdr-project-web

A localhost-only page showing what `herdr-project --watch` found and the
open projects under `~/project`, with their agents and what their notes
say waits on the user, updated as the watcher checks and their files
change.
Its Worktrees view shows how each worktree in the projects, and each
checkout under `~/repos`, differs from where its branch left the
remote's default branch, uncommitted and untracked files included.

The watcher needs its packages installed, with Node 22.6 or later: it
runs herdr-project-web, which checks all of it and serves at
http://127.0.0.1:9000/. If the page doesn't come up, look in
`~/.local/state/herdr-project/web.log`. To restart it on new code,
touch `herdr-project-web/restart.stamp`; open pages reload once it runs
another commit.

```
cd herdr-project-web && npm install
```
