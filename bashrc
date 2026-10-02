if [[ -n "${CODESPACES:-}" && $- == *i* ]]; then
    exec /bin/zsh
fi
