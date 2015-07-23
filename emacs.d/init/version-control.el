;; VC
(setq vc-follow-symlinks t)

;; Mercurial
;; installed on ~/local
(setq exec-path
      (cons (expand-file-name "~/local/bin") exec-path))
(setenv "PYTHONPATH" (expand-file-name "~/local/lib/python"))

(require-safety
 'vc-hg
 (setq vc-handled-backends (cons 'HG vc-handled-backends)))
