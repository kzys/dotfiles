;; VC
(setq vc-follow-symlinks t)

;; Subversion
(require-safety
 'dsvn
 (setq svn-status-svn-environment-var-list '("LANG=ja_JP.UTF-8"))
 (global-set-key "\C-cv" 'svn-status))

;; Mercurial
;; installed on ~/local
(setq exec-path
      (cons (expand-file-name "~/local/bin") exec-path))
(setenv "PYTHONPATH" (expand-file-name "~/local/lib/python"))

(require-safety
 'vc-hg
 (setq vc-handled-backends (cons 'HG vc-handled-backends)))
