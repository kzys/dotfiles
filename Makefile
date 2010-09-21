install: download
	python install.py

download:
	cd emacs.d/lisp/ && make
