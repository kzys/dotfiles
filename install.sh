#! /bin/bash
set -euo pipefail
IFS=$'\n\t'

setup_codespaces() {
    curl -fsSL https://claude.ai/install.sh | bash
}

link() {
    local src=$1 dest=$2

    if [[ "$(readlink "$dest" || true)" == "$src" ]]; then
        return
    fi

    mkdir -p "$(dirname "$dest")"
    if [[ -e "$dest" || -L "$dest" ]]; then
        mv "$dest" "$dest.bak"
    fi
    ln -s "$src" "$dest"
}

main() {
    local -a files=(zshrc emacs.d tmux.conf bashrc)
    for file in "${files[@]}"
    do
        link "$PWD/$file" "$HOME/.$file"
    done

    # config/ mirrors ~/.config, so each name is both source and destination.
    local -a config_files=(git/config git/ignore opencode/AGENTS.md opencode/tui.json)
    for file in "${config_files[@]}"
    do
        link "$PWD/config/$file" "$HOME/.config/$file"
    done

    # Claude reads the same house rules under its own name.
    link "$PWD/config/opencode/AGENTS.md" "$HOME/.claude/CLAUDE.md"

    # pi config is stored in ~/.pi, so mirror the repo's ./pi directory there.
    link "$PWD/pi" "$HOME/.pi"

    if [[ -n "${CODESPACES:-}" ]]; then
        setup_codespaces
    fi
}

main
