#! /bin/sh
for i in $(ls | grep -v $(basename $0))
do
    if test ! -e ~/.$i; then
        ln -s `pwd`/$i ~/.$i
    fi
done
