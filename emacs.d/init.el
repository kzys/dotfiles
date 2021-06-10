(setq debug-on-error t)

(savehist-mode)

;; Added by Package.el.  This must come before configurations of
;; installed packages.  Don't delete this line.  If you don't want it,
;; just comment it out by adding a semicolon to the start of the line.
;; You may delete these explanatory comments.
(package-initialize)

(add-to-list
 'package-archives
 '("melpa" . "https://stable.melpa.org/packages/"))

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

; find-file
(define-key minibuffer-local-map "\C-n" 'next-line-or-history-element)
(define-key minibuffer-local-map "\C-p" 'previous-line-or-history-element)

;; Use savehist instead of session
(require 'savehist)
(savehist-mode nil)

;; org
(require 'org)
(global-set-key (kbd "C-c l") 'org-store-link)
(global-set-key (kbd "C-c a") 'org-agenda)
(global-set-key (kbd "C-c c") 'org-capture)

; Custom
(custom-set-variables
 ;; custom-set-variables was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 '(gnutls-algorithm-priority "normal:-vers-tls1.3")
 '(package-selected-packages
   '(yaml-mode session scala-mode rust-mode minibuf-isearch magit lua-mode go-mode flymake-cursor)))
(custom-set-faces
 ;; custom-set-faces was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 )

(let* ((path (expand-file-name "~/.emacs.d/init-work.el")))
  (if (file-exists-p path) (load path)))

; Is it fast?
(setq initial-scratch-message (format "; %s\n" (emacs-init-time)))
