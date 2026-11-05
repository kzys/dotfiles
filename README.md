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
with its own agent; selecting a running session focuses its pane. Left and
right switch the agent a new session starts with. prefix+i lists what waits
on you instead. Other `hp` arguments pass through to the selected agent. Use
`--` before arguments that should bypass `hp`'s parser.

Run `./install_codex.py` (Python 3.11+) once to install Herdr's Codex session
integration and bin/agent-hook; `install.sh` also does this when both CLIs are
available. In Codex, use `/hooks` to review and trust the installed hooks.
`codex/config.toml` holds reusable Codex preferences, which the installer
merges into `~/.codex/config.toml`, preserving app settings. Run
`./install_codex.py --config-only` to apply just preferences, and restart Codex
to load them.

## herdr-project-web

One server, written in TypeScript, behind all of the above. `hp`, the picker,
`bin/agent-hook` and `bin/claude-statusline` are small clients of it, over a
Unix socket at `~/.local/state/herdr-project/run/server.sock`. They need it
running: without it `hp` and the picker say so and stop, and hooks do nothing.
Plain `claude` in a shell still works for fixing it.

Its localhost-only page shows the open projects under `~/project`, with their
agents, what they wait on and what their notes say waits on you, and how each
worktree differs from where its branch left the remote's default branch.
A branch's diff starts from its pull request's base, for the open ones the
watcher finds (yours, updated in the last two weeks), else the base chosen on
the page, which `gh pr create` also uses, else the branch it was created from
until that is merged, else the default branch.

Clicking a line number in a diff comments on that line, and the comments go to
the agent you choose as one message, once it is idle.

The server runs in a pane of the `watch` workspace. Shells in Herdr start it if
no pane has it, which needs Node 22.13 or later and its packages:

```
cd herdr-project-web && npm install
```

It serves http://127.0.0.1:9000/. If the page doesn't come up, look in
`~/.local/state/herdr-project/web.log`. To restart it on new code, touch
`herdr-project-web/restart.stamp`; open pages reload once it runs another
commit.
