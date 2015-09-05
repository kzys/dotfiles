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
