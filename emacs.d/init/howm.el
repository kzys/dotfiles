
;; Howm
(setq load-path
      (cons (expand-file-name "~/src/howm-1.3.5") load-path))
(require-safety
 'howm
 (global-set-key "\C-c,," 'howm-menu)
 (setq howm-menu-lang 'ja)
 (setq howm-template "= <<< %title%cursor\n\n")
 (setq howm-menu-expiry-hours 2)
 (setq howm-menu-refresh-after-save nil)
 (add-to-list 'auto-mode-alist '("\\.howm$" . howm-mode)) )
