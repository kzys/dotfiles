install: download
	sh setup.sh

download:
	cd emacs.d/lisp/ && make
