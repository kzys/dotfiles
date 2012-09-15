install: install-misc install-emacs make-private

install-misc: zsh/functions/git-escape-magic
	python install.py

install-emacs:
	cd emacs.d/lisp/ && make

zsh/functions/git-escape-magic:
	curl -L https://raw.github.com/knu/zsh-git-escape-magic/master/git-escape-magic > $@

make-private:
	git config user.name 'Kato Kazuyoshi'
	git config user.email 'kato.kazuyoshi@gmail.com'
