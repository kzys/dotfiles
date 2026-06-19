# dotfiles

This is my configuration files from day-to-day computers to
[GitHub Codespaces](https://docs.github.com/en/codespaces/setting-your-user-preferences/personalizing-github-codespaces-for-your-account).

```
ansible-playbook playbook.yml
```

## Atlassian keep-alive

Jira/Confluence Cloud accounts get deactivated from inactivity. `atlassian_keepalive.py`
pings both APIs daily via a systemd user timer (`atlassian-keepalive.service`/`.timer`),
set up by the same playbook.

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
