;; Perl
(setq auto-mode-alist
      (append '(("\\.p[lm]$" . cperl-mode)
                ("\\.t$" . cperl-mode)) auto-mode-alist))
(add-to-list 'interpreter-mode-alist
             '("perl" . cperl-mode))
(setq auto-mode-alist
      (cons '("\\.tt$" . html-mode) auto-mode-alist))

;; Perl Best Practices 2.11
(setq cperl-close-paren-offset -4
      cperl-continued-statement-offset 4
      cperl-indent-level 4
      cperl-indent-parens-as-block t
      cperl-tab-always-indent t)

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
