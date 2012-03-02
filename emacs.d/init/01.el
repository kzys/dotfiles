(add-to-list 'load-path
             (expand-file-name "~/.emacs.d/lisp"))

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
;; D http://www.sodan.org/~knagano/emacs/minibuf-isearch/minibuf-isearch.el
(require 'minibuf-isearch)
(setq minibuf-isearch-use-migemo nil)

;; JavaScript
;; D http://repo.or.cz/w/emacs.git/blob_plain/6b45354a9e8f5db5e283025cc0b7ea053408f176:/lisp/progmodes/js.el
(if (not (functionp 'declare-function))
    (defmacro declare-function (&rest args)))
(require 'js)
(add-to-list 'auto-mode-alist '("\\.js$" . js-mode))

;; Subversion
;; D http://svn.apache.org/repos/asf/subversion/trunk/contrib/client-side/emacs/dsvn.el
(require 'dsvn)
(setq svn-program (expand-file-name "~/.emacs.d/svn-with-lv"))

(defun -newest-dir (pattern subdir)
  (let* ((dirs (file-expand-wildcards (expand-file-name pattern)))
         (path (car (sort (remove-if-not 'file-directory-p dirs)
                          (lambda (a b)
                            (not (string-lessp a b)))))))
    (if path (concat path subdir) nil)))

(add-to-list 'load-path
             (expand-file-name "~/local/share/emacs/site-lisp/"))
(require 'magit)
