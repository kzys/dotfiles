;; This file contains very basic settings of Emacs.
;; I can recommend them for my coworkers (especially a newbie).

;; C-h should be "delete" because it's very common convention in Unix.
(global-set-key "\C-h" 'backward-delete-char-untabify)
(global-set-key "\C-ch" 'help)

;; On Emacs, C-n and C-p is "up" and "down".
;; But in Minibuffer, default settings break this convention.
(mapcar (lambda (keymap)
	  (define-key keymap "\C-n" 'next-history-element)
	  (define-key keymap "\C-p" 'previous-history-element))
	(list minibuffer-local-map
	      minibuffer-local-ns-map
	      minibuffer-local-completion-map))

;; "Region" should be visible.
(transient-mark-mode t)

;; Show "matched" parenthesis.
(require 'mic-paren)
(paren-activate)

;; Some libraries are not included on standard distribution.
;; But we must use them for *acceptable* setting.
(add-to-list 'load-path
	     (expand-file-name "~/.emacs.d/lisp"))

;; Emacs should save histories.
;; http://d.hatena.ne.jp/higepon/20061230/1167447339 (Japanese)
(require 'session)

(setq session-initialize t)
(setq session-save-file (expand-file-name "~/.emacs.d/session"))
(setq session-globals-include '((kill-ring 50)
				(session-file-alist 500 t)
				(file-name-history 10000)))
(setq session-globals-max-string 100000000)
(setq history-length t)
(add-hook 'after-init-hook 'session-initialize)
