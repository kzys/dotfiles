#! /bin/sh
set -eu

path="$1"

if [ -e "$HOME/.$path" ]; then
    if [ -L "$HOME/.$path" ]; then
        actual=$(readlink "$HOME/.$path")
        if [ "$actual" = "$PWD/$path" ]; then
            echo ok
        else
            echo "$HOME/.$path is pointing to $actual"
        fi
    fi
else
    ln -s "$PWD/$path" "$HOME/.$path"
fi
