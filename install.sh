#! /bin/bash
set -euo pipefail
IFS=$'\n\t'

setup_github_codespaces() {
    sudo chsh "$(id -un)" --shell "/usr/bin/zsh"
}

main() {
    local -a files=(zshrc emacs.d gitconfig tmux.conf)
    for file in "${files[@]}"
    do
        if [[ -e "$HOME/.$file" ]]; then
            mv "$HOME/.$file" "$HOME/.$file.bak"
        fi
        ln -s "$PWD/$file" "$HOME/.$file"
    done

    if [[ -n "${CODESPACES:-}" ]]; then
	setup_github_codespaces
    fi

    env
}

main
