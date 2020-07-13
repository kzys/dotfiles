(add-to-list 'load-path
             (expand-file-name "~/.emacs.d/lisp"))

(mapcar
 (lambda (package)
   (if (package-installed-p package)
       t
    (package-install package)))
 (list 'go-mode 'magit 'scala-mode 'dsvn 'ruby-mode
       'org
       'flymake-cursor
       'minibuf-isearch))

;; Incremental Search on Minibuffer
(require 'minibuf-isearch)
(setq minibuf-isearch-use-migemo nil)

;; org-mode
(require 'org)
(setq org-startup-truncated nil)
(define-key global-map "\C-cl" 'org-store-link)
(define-key global-map "\C-ca" 'org-agenda)
(define-key global-map "\C-cc" 'org-capture)
(setq org-log-done t)
(setq org-agenda-files '("~/journal/work" "~/journal/home"))
(setq org-default-notes-file
      (expand-file-name (format-time-string "~/journal/%Y-%m.org.txt")))
(add-to-list 'auto-mode-alist '("\\.org\\.txt\\'" . org-mode))
(setq org-agenda-file-regexp "\\.org\\.txt\\'")
(setq org-directory "~/journal")

(setq org-todo-keywords
      '((sequence "TODO" "WAIT" "|" "DONE")))
(setq org-todo-keyword-faces
      '(("TODO" . "red")
        ("WAIT" . "orange")
        ("DONE" . "darkgreen")))
(require 'js)
(add-hook 'js-mode-hook
          (lambda ()
            (setq js-indent-level 2)))
