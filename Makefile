gitconfig: gitconfig.public gitconfig.private
	cat $^ > gitconfig

install: download gitconfig
	python install.py

download:
	cd emacs.d/lisp/ && make
