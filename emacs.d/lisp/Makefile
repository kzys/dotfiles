session_version = 2.2

all: download session.el ruby-mode.el

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
