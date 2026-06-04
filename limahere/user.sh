#!/bin/sh
# Run as the VM user on first boot. Install Claude Code per-user via its
# official installer.
set -eux
curl -fsSL https://claude.ai/install.sh | bash
# Make zsh (installed by system.sh) the login shell for this user.
sudo chsh -s "$(command -v zsh)" "$(whoami)"
