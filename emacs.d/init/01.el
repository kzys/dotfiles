(add-to-list 'load-path
             (expand-file-name "~/.emacs.d/lisp"))

(mapcar
 (lambda (package)
   (if (package-installed-p package)
       t
    (package-install package)))
   (list 'go-mode 'magit 'session 'scala-mode 'dsvn 'ruby-mode
         'minibuf-isearch))

;; recentf saves histories of files. But session saves other histories too.
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

;; Incremental Search on Minibuffer
(require 'minibuf-isearch)
(setq minibuf-isearch-use-migemo nil)

(defun -newest-dir (pattern subdir)
  (let* ((dirs (file-expand-wildcards (expand-file-name pattern)))
         (path (car (sort (remove-if-not 'file-directory-p dirs)
                          (lambda (a b)
                            (not (string-lessp a b)))))))
    (if path (concat path subdir) nil)))
