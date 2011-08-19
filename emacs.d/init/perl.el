(defun perl-root-directory (path)
  (cond
   ((string-match "^\\(.*?/\\)\\(lib\\|t\\)" path)
    (match-string 1 path))
   (t
    (file-name-directory path)) ))

;; Perl + Flymake

(add-hook 'cperl-mode-hook
          '(lambda ()
             (flymake-mode 1)))
(add-to-list 'flymake-allowed-file-name-masks '("\\.pm$" flymake-perl-init))
(add-to-list 'flymake-allowed-file-name-masks '("\\.t$" flymake-perl-init))
