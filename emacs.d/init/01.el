(add-to-list 'load-path
             (expand-file-name "~/.emacs.d/lisp"))

(mapcar
 (lambda (package)
   (if (package-installed-p package)
       t
    (package-install package)))
 (list 'go-mode 'magit 'session 'scala-mode 'dsvn 'ruby-mode
       'flymake-cursor 'minibuf-isearch))

;; History
(require 'session)

(setq session-initialize t)
(setq session-save-file (expand-file-name "~/.emacs.d/session"))
(setq session-globals-include '((kill-ring 50)
				(session-file-alist 500 t)
				(file-name-history 10000)))
(setq session-globals-max-string 100000000)
(setq history-length t)
(add-hook 'after-init-hook 'session-initialize)

;; Incremental Search on Minibuffer
(require 'minibuf-isearch)
(setq minibuf-isearch-use-migemo nil)

(require 'org)
(setq org-startup-truncated nil)
(define-key global-map "\C-cl" 'org-store-link)
(define-key global-map "\C-ca" 'org-agenda)
(define-key global-map "\C-cc" 'org-capture)
(setq org-log-done t)
(setq org-agenda-files (list (expand-file-name "~/journal")))
(setq org-default-notes-file
      (expand-file-name (format-time-string "~/journal/%Y-%m.org.txt")))
(add-to-list 'auto-mode-alist '("\\.org.txt\\'" . org-mode))
(setq org-agenda-file-regexp "\\.org.txt\\'")

(require 'js)
(add-hook 'js-mode-hook
          (lambda ()
            (setq js-indent-level 2)))
