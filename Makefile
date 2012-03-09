gitconfig: gitconfig.public gitconfig.private
	cat $^ > gitconfig

install: install-misc install-emacs

install-misc: zsh/functions/git-escape-magic
	python install.py

install-emacs:
	cd emacs.d/lisp/ && make

zsh/functions/git-escape-magic:
	curl -L https://raw.github.com/knu/zsh-git-escape-magic/master/git-escape-magic > $@
