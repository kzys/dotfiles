# dotfiles

This is my configuration files from day-to-day computers to
[GitHub Codespaces](https://docs.github.com/en/codespaces/setting-your-user-preferences/personalizing-github-codespaces-for-your-account).

```
ansible-playbook user.yml
sudo ansible-playbook root.yml
```

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

Manual run / check status:

```bash
systemctl --user start atlassian-keepalive.service
journalctl --user -u atlassian-keepalive.service -n 20
systemctl --user list-timers atlassian-keepalive.timer
```

On servers/headless machines, run `loginctl enable-linger $USER` so the user timer
fires without an active login session.

## Herdr agent selection

Set one variable before starting Herdr (or export it in your shell config):

```sh
export HERDR_AGENT=codex   # claude is the default
herdr
```

This selects the agent for `hp`, the prefix+w project picker, `herdr-adopt`,
and `cdc`. New panes keep the picker's selection. Existing sessions keep their
agent; the picker lists sessions for the selected agent. Restart the Herdr server after
changing the variable so its popups inherit the new value.

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
