#! /bin/bash
set -euo pipefail
IFS=$'\n\t'

setup_codespaces() {
    curl -fsSL https://claude.ai/install.sh | bash
}

main() {
    local -a files=(zshrc emacs.d gitconfig tmux.conf bashrc)
    for file in "${files[@]}"
    do
        if [[ -e "$HOME/.$file" ]]; then
            mv "$HOME/.$file" "$HOME/.$file.bak"
        fi
        ln -s "$PWD/$file" "$HOME/.$file"
    done

    if [[ -n "${CODESPACES:-}" ]]; then
        setup_codespaces
    fi
}

main
