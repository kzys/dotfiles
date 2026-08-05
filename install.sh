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
    local -a files=(zshrc emacs.d gitconfig tmux.conf bashrc)
    for file in "${files[@]}"
    do
        link "$PWD/$file" "$HOME/.$file"
    done

    link "$PWD/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"

    if [[ -n "${CODESPACES:-}" ]]; then
        setup_codespaces
    fi
}

main
