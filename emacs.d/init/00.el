(add-to-list 'load-path
	     (expand-file-name "~/.emacs.d/lisp"))

;; Should save histories.
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

;; Wanna use C-n and C-p on Minibuffer.
(mapcar (lambda (keymap)
	  (define-key keymap "\C-n" 'next-history-element)
	  (define-key keymap "\C-p" 'previous-history-element))
	(list minibuffer-local-map
	      minibuffer-local-ns-map
	      minibuffer-local-completion-map))

;; Region should be visible
(transient-mark-mode t)

;; Wanna see matched parentheses.
(require 'mic-paren)
(paren-activate)

;; C-h should be "delete".
(global-set-key "\C-h" 'backward-delete-char-untabify)
(global-set-key "\C-ch" 'help)
