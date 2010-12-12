session_version = 2.2

all: download session.el ruby-mode.el moccur-edit.el js.el dsvn.el anything-project.el git.el sgml-match-mode.el auto-install.el

download:
	python update.py

sgml-match-mode.el:
	curl -LO https://github.com/kzys/sgml-match-mode/raw/master/lisp/sgml-match-mode.el

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

git.el:
	curl 'http://git.kernel.org/?p=git/git.git;a=blob_plain;f=contrib/emacs/git.el;hb=HEAD' > $@

auto-install.el:
	curl -LO http://www.emacswiki.org/emacs/download/auto-install.el