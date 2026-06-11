#!/bin/sh
# Run as the VM user on first boot. Install Claude Code per-user via its
# official installer.
set -eux
curl -fsSL https://claude.ai/install.sh | bash
# Install Go under ~/sdk/<version> so the seeded .zshrc (which globs ~/sdk for
# the newest install and adds its bin to PATH) picks it up automatically.
go_version=$(curl -fsSL "https://go.dev/VERSION?m=text" | head -n1)
# Go's release naming (amd64/arm64) matches `dpkg --print-architecture`.
go_arch=$(dpkg --print-architecture)
mkdir -p ~/sdk
curl -fsSL "https://go.dev/dl/${go_version}.linux-${go_arch}.tar.gz" | tar -C ~/sdk -xz
rm -rf ~/sdk/"$go_version"
mv ~/sdk/go ~/sdk/"$go_version"
# Make zsh (installed by system.sh) the login shell for this user.
sudo chsh -s "$(command -v zsh)" "$(whoami)"
# Drop existing sessions so the new login shell takes effect.
sudo loginctl terminate-user "$USER"
