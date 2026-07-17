#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "requests",
# ]
# ///
"""
Keeps Atlassian Cloud accounts active by performing read-only Jira and
Confluence activity (profile, searches, and content reads). Plain
authentication pings don't seem to count as product usage for Atlassian's
free-plan dormancy checks, so this mimics light browsing instead.

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
from requests.adapters import HTTPAdapter
from requests.auth import HTTPBasicAuth
from urllib3.util.retry import Retry

logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)

# (service, label, path, query params)
ACTIVITIES = [
    ("Jira", "profile", "/rest/api/3/myself", {}),
    ("Jira", "recent issues", "/rest/api/3/search/jql",
     {"jql": "created >= -365d order by created desc", "maxResults": "5", "fields": "summary"}),
    ("Jira", "projects", "/rest/api/3/project/search", {"maxResults": "5"}),
    ("Confluence", "profile", "/wiki/rest/api/user/current", {}),
    ("Confluence", "spaces", "/wiki/api/v2/spaces", {"limit": "5"}),
    ("Confluence", "recent pages", "/wiki/api/v2/pages",
     {"limit": "5", "sort": "-modified-date"}),
]


def get_config():
    domain = os.environ.get("ATLASSIAN_DOMAIN", "").strip()
    email = os.environ.get("ATLASSIAN_EMAIL", "").strip()
    token = os.environ.get("ATLASSIAN_API_TOKEN", "").strip()
    missing = [k for k, v in [("ATLASSIAN_DOMAIN", domain), ("ATLASSIAN_EMAIL", email), ("ATLASSIAN_API_TOKEN", token)] if not v]
    if missing:
        log.error("Missing env vars: %s", ", ".join(missing))
        sys.exit(1)
    return domain, email, token


def make_session(email, token):
    session = requests.Session()
    session.auth = HTTPBasicAuth(email, token)
    session.headers.update({"Accept": "application/json"})
    # Right after boot the timer can fire before DNS is up; back off and retry.
    retry = Retry(total=5, connect=5, backoff_factor=3, status_forcelist=[429, 502, 503, 504])
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def visit(session, base, service, label, path, params):
    try:
        r = session.get(f"{base}{path}", params=params, timeout=30)
        r.raise_for_status()
        log.info("%-10s  %-14s OK", service, label)
        return True
    except requests.HTTPError as e:
        log.error("%-10s  %-14s HTTP %s: %s", service, label, e.response.status_code, e.response.text[:200])
    except requests.RequestException as e:
        log.error("%-10s  %-14s request failed: %s", service, label, e)
    return False


def main():
    domain, email, token = get_config()
    base = f"https://{domain}.atlassian.net"
    session = make_session(email, token)

    log.info("Visiting Atlassian Cloud (%s) at %s", domain, datetime.now(timezone.utc).isoformat())

    results = [visit(session, base, service, label, path, params)
               for service, label, path, params in ACTIVITIES]

    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
