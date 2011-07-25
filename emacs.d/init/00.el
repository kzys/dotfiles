(add-to-list 'load-path
	     (expand-file-name "~/.emacs.d/lisp"))

;; Session
;; http://d.hatena.ne.jp/higepon/20061230/1167447339
(require 'session)

(setq session-initialize t)
(setq session-save-file (expand-file-name "~/.emacs.d/session"))
(setq session-globals-include '((kill-ring 50)
				(session-file-alist 500 t)
				(file-name-history 10000)))
(setq session-globals-max-string 100000000)
(setq history-length t)
(add-hook 'after-init-hook 'session-initialize)

(mapcar (lambda (keymap)
	  (define-key keymap "\C-n" 'next-history-element)
	  (define-key keymap "\C-p" 'previous-history-element))
	(list minibuffer-local-map
	      minibuffer-local-ns-map
	      minibuffer-local-completion-map))
