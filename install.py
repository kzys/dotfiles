#! /usr/bin/python

import glob
import os
import re

pattern = re.compile('^.*(~|\.py|\.sh|Makefile)$')

for path in [path for path in glob.glob('*') if pattern.match(path) == None]:
    dst = os.path.join(os.environ['HOME'], '.' + os.path.basename(path))
    if os.path.islink(dst):
        os.remove(dst)
    os.symlink(os.path.join(os.getcwd(), path), dst)
