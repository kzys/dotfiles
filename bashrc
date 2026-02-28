set -euo pipefail

env

if [[ -n "${CODESPACES:-}" ]]; then
    exec /bin/zsh
fi
