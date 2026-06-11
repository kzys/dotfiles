#!/bin/sh
# Run as root on first boot. Install apt packages.
# (curl is needed by user.sh's Claude Code installer.)
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y build-essential curl tmux zsh

# Add GitHub CLI's apt repo so `gh` is available.
mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update
apt-get install -y gh
