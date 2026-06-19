#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "requests",
# ]
# ///
"""
Keeps Atlassian Cloud accounts active by hitting Jira and Confluence APIs.

Required env vars:
  ATLASSIAN_DOMAIN    — subdomain only, e.g. "mycompany" for mycompany.atlassian.net
  ATLASSIAN_EMAIL     — your login email
  ATLASSIAN_API_TOKEN — API token from https://id.atlassian.com/manage-profile/security/api-tokens
"""

import os
import sys
import logging
from datetime import datetime, timezone
import requests
from requests.auth import HTTPBasicAuth

logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)


def get_config():
    domain = os.environ.get("ATLASSIAN_DOMAIN", "").strip()
    email = os.environ.get("ATLASSIAN_EMAIL", "").strip()
    token = os.environ.get("ATLASSIAN_API_TOKEN", "").strip()
    missing = [k for k, v in [("ATLASSIAN_DOMAIN", domain), ("ATLASSIAN_EMAIL", email), ("ATLASSIAN_API_TOKEN", token)] if not v]
    if missing:
        log.error("Missing env vars: %s", ", ".join(missing))
        sys.exit(1)
    return domain, email, token


def ping(session, url, service):
    try:
        r = session.get(url, timeout=15)
        r.raise_for_status()
        data = r.json()
        display = data.get("displayName") or data.get("username") or data.get("accountId", "?")
        log.info("%s  OK — logged in as: %s", service, display)
        return True
    except requests.HTTPError as e:
        log.error("%s  HTTP %s: %s", service, e.response.status_code, e.response.text[:200])
    except requests.RequestException as e:
        log.error("%s  request failed: %s", service, e)
    return False


def main():
    domain, email, token = get_config()
    base = f"https://{domain}.atlassian.net"

    session = requests.Session()
    session.auth = HTTPBasicAuth(email, token)
    session.headers.update({"Accept": "application/json"})

    log.info("Pinging Atlassian Cloud (%s) at %s", domain, datetime.now(timezone.utc).isoformat())

    jira_ok = ping(session, f"{base}/rest/api/3/myself", "Jira      ")
    confluence_ok = ping(session, f"{base}/wiki/rest/api/user/current", "Confluence")

    if not (jira_ok and confluence_ok):
        sys.exit(1)


if __name__ == "__main__":
    main()
