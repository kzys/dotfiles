(setq debug-on-error nil)

(set-language-environment "Japanese")

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
        (width . 120)
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
(global-set-key (kbd "C-c l") 'org-store-link)
(global-set-key (kbd "C-c a") 'org-agenda)
(with-eval-after-load 'org
  (setq org-startup-truncated nil)
  (setq org-startup-folded 'content)
  (setq org-ellipsis " ...")
  (custom-set-faces '(org-ellipsis ((t (:foreground "#999999" :underline nil))))))

(global-set-key (kbd "C-c c") 'org-capture)
(with-eval-after-load 'org-capture
  (setq org-capture-templates
	'(("h" "home" entry
	   (file+headline (lambda ()
			    (format-time-string "~/org/home/%Y-%m-home.org")) "Inbox") "* TODO %?\n%T")
	  ("w" "work" entry
	   (file+headline (lambda ()
			    (format-time-string "~/org/work/%Y-%m-work.org")) "Inbox") "* TODO %?\n%T"))))

(with-eval-after-load 'org-agenda
  (setq org-agenda-files (list "~/org/home" "~/org/work"))

  (setq org-todo-keywords
	'((sequence "TODO" "WAIT" "|" "DONE")))
  (setq org-todo-keyword-faces
	'(("TODO" :foreground "#006600")
	  ("WAIT" :foreground "#996600"))))

; Custom
(custom-set-variables
 ;; custom-set-variables was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 '(gnutls-algorithm-priority "normal:-vers-tls1.3")
 '(package-selected-packages
   '(graphviz-dot-mode markdown-mode eglot flymake marginalia vertico yaml-mode session scala-mode rust-mode minibuf-isearch magit lua-mode go-mode flymake-cursor)))
(custom-set-faces
 ;; custom-set-faces was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 )

(let* ((path (expand-file-name "~/.emacs.d/init-work.el")))
  (if (file-exists-p path) (load path)))

;; Make eglot work on aws/amazon-ecs-agent where there is agent/go.mod.
(defun -project-try-gomod (dir)
  (if (file-exists-p (concat (file-name-as-directory dir) "go.mod"))
      dir
    (if (string-equal dir "/")
	(-project-try-gomod (file-name-directory (directory-file-name dir))))))
(add-hook 'project-find-functions '-project-try-gomod)
(add-hook 'go-mode-hook (lambda()
			  (eglot-ensure)))

(setq ring-bell-function 'ignore)

;; rust-mode + elgot uses eglot-inlay-hint-face a lot, which is too small.
(with-eval-after-load 'eglot
  (set-face-attribute 'eglot-inlay-hint-face nil :height 1.0)
  (setq eglot-sync-connect 1))
(add-hook 'rust-mode-hook (lambda()
			  (eglot-ensure)))


; Is it fast?
(setq initial-scratch-message (format "; %s\n" (emacs-init-time)))
