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

;; Flymake
(require 'flymake)

(defun flymake-display-err-on-minibuffer ()
  "Displays the error/warning for the current line in the minibuffer"
  (interactive)
  (let* ((line-no             (flymake-current-line-no))
         (line-err-info-list  (nth 0 (flymake-find-err-info flymake-err-info line-no)))
         (count               (length line-err-info-list))
         (messages))
    (while (> count 0)
      (let* ((info (nth (1- count) line-err-info-list))
             (file (flymake-ler-file info))
             (text (flymake-ler-text info))
             (line (flymake-ler-line info))
             (full-file (flymake-ler-full-file info)))
        (setq messages (cons (format "%d: %s" line text) messages)))
      (setq count (1- count)))
    (if (> (length messages) 0)
        (message "%s"
                 (mapconcat 'identity messages "\n")))))

(run-with-idle-timer 1 t 'flymake-display-err-on-minibuffer)

;; recentf
(recentf-mode 1)
(setq recentf-save-file "~/.emacs.d/recentf")
