session_version = 2.2

all: download session.el ruby-mode.el moccur-edit.el js.el dsvn.el anything-project.el

download:
	python update.py

session-$(session_version).tar.gz:
	curl -L http://sf.net/projects/emacs-session/files/session/$(session_version)/session-$(session_version).tar.gz/download > $@

session: session-$(session_version).tar.gz
	tar xvf $^

session.el: session
	cp session/lisp/session.el .

ruby-mode.el:
	svn export http://svn.ruby-lang.org/repos/ruby/trunk/misc/ruby-mode.el

moccur-edit.el:
	curl -O http://www.bookshelf.jp/elc/moccur-edit.el

js.el:
	curl -O http://repo.or.cz/w/emacs.git/blob_plain/HEAD:/lisp/progmodes/js.el

dsvn.el:
	curl -O http://svn.apache.org/repos/asf/subversion/trunk/contrib/client-side/emacs/dsvn.el

anything-project.el:
	curl -O http://github.com/imakado/anything-project/raw/master/anything-project.el
