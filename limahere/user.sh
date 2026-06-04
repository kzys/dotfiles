#!/bin/sh
# Run as the VM user on first boot. Install Claude Code per-user via its
# official installer.
set -eux
curl -fsSL https://claude.ai/install.sh | bash
