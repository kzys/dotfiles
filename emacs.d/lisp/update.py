#! /usr/bin/python
import re, urllib, os

list = [
    'http://www.foldr.org/~michaelw/objective-c/objc-c-mode.el',
    'http://howm.sourceforge.jp/a/howm-1.3.6.tar.gz',
    'http://www.bookshelf.jp/elc/color-moccur.el',
    'http://www.pitecan.com/papers/JSSSTDmacro/dmacro.el',
    ]

pattern = re.compile(r'\.el$')
for uri in list:
    print uri,

    if pattern.search(uri):
        pass
    else:
        print " tarball"
        continue

    local = os.path.basename(uri)
    if os.path.exists(local):
        print " found"
        pass
    else:
        print " ..."
        local = open(local, 'w')
        local.write(urllib.urlopen(uri).read())
