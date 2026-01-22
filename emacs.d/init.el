(setq debug-on-error nil)

(set-language-environment "Japanese")

;; # Line
(global-display-line-numbers-mode t)
(set-face-attribute 'line-number nil :foreground "#cccccc")
(set-face-attribute 'line-number-current-line nil :foreground "#999999")

;; # Column
(column-number-mode)
(global-display-fill-column-indicator-mode t)
(set-face-attribute 'fill-column-indicator nil :foreground "#f0f0f0")
(setq fill-column 80)

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

;; # Setting the default and modifying the parameters
(let ((frame '((tool-bar-lines . 0)
	       (width . 100)
	       (height . 40)
	       (left . 50)
	       (top . 100))))
  (setq default-frame-alist frame)
  (modify-frame-parameters nil frame))


; C-h as Backspace
(global-set-key "\C-ch" 'help)
(keyboard-translate ?\C-h ?\C-?)

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
 '(gnutls-algorithm-priority "normal:-vers-tls1.3")
 '(package-selected-packages
   '(dockerfile-mode company elixir-mode graphviz-dot-mode markdown-mode eglot flymake marginalia vertico yaml-mode session scala-mode rust-mode minibuf-isearch magit lua-mode go-mode flymake-cursor)))
(custom-set-faces
 ;; custom-set-faces was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 )

(let* ((path (expand-file-name "~/.emacs.d/init-work.el")))
  (if (file-exists-p path) (load path)))

(setq ring-bell-function 'ignore)

; Is it fast?
(setq initial-scratch-message (format "; %s\n" (emacs-init-time)))

; # Use binaries from proto
(dolist (path (list "~/.proto/shims"))
  (let ((p (expand-file-name path)))
    (if (file-exists-p p)
	(setenv "PATH" (concat p ":" (getenv "PATH"))))))

; # Platform-specific settings
(cond
 ((eq system-type 'gnu/linux)
  (set-frame-font "Ubuntu Mono-12" nil t)
  (set-fontset-font t 'japanese-jisx0208 "Noto Sans Mono CJK JP-12"))
 ((eq system-type 'darwin) nil))
