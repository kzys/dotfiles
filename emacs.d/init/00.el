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

;; perl-mode can't handle some syntax of Perl.
;; I recommend that you use cperl-mode.
(setq auto-mode-alist
      (append '(("\\.p[lm]$" . cperl-mode)
                ("\\.t$" . cperl-mode)) auto-mode-alist))
(add-to-list 'interpreter-mode-alist
             '("perl" . cperl-mode))

;; But cperl-mode's default settings is not so good.
;; I prefer "Perl Best Practices" 2.11.
(setq cperl-close-paren-offset -4
      cperl-continued-statement-offset 4
      cperl-indent-level 4
      cperl-indent-parens-as-block t
      cperl-tab-always-indent t)

;; Show "matched" parenthesis.
(show-paren-mode 1)

;; Shouldn't use "hard tab" on code.
(setq-default indent-tabs-mode nil)
(setq-default tab-width 4)
