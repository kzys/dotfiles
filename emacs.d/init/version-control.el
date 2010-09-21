;; VC
(setq vc-follow-symlinks t)

;; Subversion
(require 'dsvn)
(setq svn-program (expand-file-name "~/dotfile/emacs.d/svn-with-lv"))


;; Mercurial
;; installed on ~/local
(setq exec-path
      (cons (expand-file-name "~/local/bin") exec-path))
(setenv "PYTHONPATH" (expand-file-name "~/local/lib/python"))

(require-safety
 'vc-hg
 (setq vc-handled-backends (cons 'HG vc-handled-backends)))

(require 'git)
