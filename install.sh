#! /bin/bash
set -euo pipefail
IFS=$'\n\t'

main() {
    local -a files=(zshrc emacs.d gitconfig tmux.conf bashrc)
    for file in "${files[@]}"
    do
        if [[ -e "$HOME/.$file" ]]; then
            mv "$HOME/.$file" "$HOME/.$file.bak"
        fi
        ln -s "$PWD/$file" "$HOME/.$file"
    done

    env
}

main
