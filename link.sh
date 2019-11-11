#! /bin/sh
set -eu

path="$1"

if [ -L "$HOME/.$path" ]; then
    actual=$(readlink "$HOME/.$path")
    if [ "$actual" = "$PWD/$path" ]; then
        echo ok
    else
        echo "$HOME/.$path is pointing $actual"
        rm "$HOME/.$path"
        ln -s "$PWD/$path" "$HOME/.$path"
    fi
else
    ln -s "$PWD/$path" "$HOME/.$path"
fi
