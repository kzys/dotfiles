set -euo pipefail

if [[ -n "${CODESPACES:-}" ]]; then
    exec /bin/zsh
fi
