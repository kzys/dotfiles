#!/bin/sh
# Run as root on first boot. Install apt packages.
# (curl is needed by user.sh's Claude Code installer.)
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y build-essential curl
