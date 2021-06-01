; -*- Emacs-Lisp -*-
(setq debug-on-error t)

; C-x C-f should start from ~/
(setq inhibit-startup-message t)
(setq default-directory "~/")

; Don't ask "Symbolic link to Git-controlled source file; follow link?"
(setq vc-follow-symlinks t)

(blink-cursor-mode -1)

(setq default-frame-alist
      '((tool-bar-lines . 0)
        (width . 110)
        (height . 60)
        (left . 100)
	(top . 0)))

; C-h as Backspace
(global-set-key "\C-ch" 'help)
(keyboard-translate ?\C-h ?\C-?)

(add-to-list 'package-archives
             '("melpa-stable" . "https://stable.melpa.org/packages/") t)

; find-file
(define-key minibuffer-local-map "\C-n" 'next-line-or-history-element)
(define-key minibuffer-local-map "\C-p" 'previous-line-or-history-element)

;; Use savehist instead of session
(require 'savehist)
(savehist-mode nil)

; Custom
(custom-set-variables
 ;; custom-set-variables was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 '(package-selected-packages
   '(scala-mode rust-mode projectile minibuf-isearch markdown-mode magit ivy go-mode flymake-cursor dsvn)))

; Is it fast?
(setq initial-scratch-message (format "; %s\n" (emacs-init-time)))
