#! /bin/sh
files='emacs emacs.d gitconfig hgrc tmux.conf'
for i in $files
do
    in_repo="$PWD/$i"
    in_home="$HOME/.$i"

    if [ -e $in_home ]; then
        link_to=$(readlink $in_home)
        if [ $? == 0 ]; then
            if [ "$link_to" == "$in_repo" ]; then
                echo "ok : $in_home is a symlink to $PWD"
            else
                echo "ok : $in_home is not a symlink to $in_repo"
            fi
        else
            echo "err: $in_home is not a symlink"
        fi
    else
        echo "err: failed to find $in_home"
        ln -s "$in_repo" "$in_home"
    fi
done
