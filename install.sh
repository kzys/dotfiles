#! /bin/bash
# GitHub Codespaces runs this script when it sets up a codespace with
# this repository as its dotfiles, so keep all setup here rather than in
# the Makefile.
# https://docs.github.com/en/codespaces/setting-your-user-preferences/personalizing-github-codespaces-for-your-account#dotfiles
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
    local -a files=(zshrc zshenv emacs.d tmux.conf bashrc)
    for file in "${files[@]}"
    do
        link "$PWD/$file" "$HOME/.$file"
    done

    # config/ mirrors ~/.config, so each name is both source and destination.
    local -a config_files=(git/config git/ignore opencode/AGENTS.md opencode/tui.json foot/foot.ini herdr/config.toml)
    for file in "${config_files[@]}"
    do
        link "$PWD/config/$file" "$HOME/.config/$file"
    done

    # Claude reads the same house rules under its own name.
    link "$PWD/config/opencode/AGENTS.md" "$HOME/.claude/CLAUDE.md"
    "$PWD/install-claude.py"

    # pi config is stored in ~/.pi, so mirror the repo's ./pi directory there.
    link "$PWD/pi" "$HOME/.pi"

    # skills/ mirrors ~/.claude/skills, one directory per skill.
    local -a skills=(kwsk)
    for skill in "${skills[@]}"
    do
        link "$PWD/skills/$skill" "$HOME/.claude/skills/$skill"
    done

    if [[ -n "${CODESPACES:-}" ]]; then
        setup_codespaces
    fi
}

main
