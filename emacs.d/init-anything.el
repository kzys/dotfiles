;; Anything
(setq anything-c-use-standard-keys t)
(require-safety
 'anything-config
 (global-set-key "\C-xb" 'anything)

 (setq anything-type-attributes
       '((file (action . (("Find File" . find-file)
                          ("Find File (Prompt)" .
                           (lambda (file)
                             (find-file (read-file-name "Find file: " file file))))
                          ("Delete File" . (lambda (file)
                                             (if (y-or-n-p (format "Really delete file %s? "
                                                                   file))
                                                 (delete-file file)))))))
         (buffer (action . (("Switch to Buffer" . switch-to-buffer)
                            ("Pop to Buffer"    . pop-to-buffer)
                            ("Display Buffer"   . display-buffer)
                            ("Kill Buffer"      . kill-buffer))))))

 (defun anything-select-action-or-execute-2nd-action ()
   (interactive)
   (when (get-buffer-window anything-action-buffer 'visible)
     (anything-next-line)
     (exit-minibuffer))
   (anything-select-action))
 (define-key anything-map "\t" 'anything-select-action-or-execute-2nd-action)

 (setq anything-c-source-howm-recent-menu
       '((name . "howm")
         (candidates . (lambda ()
                         (mapcar (lambda (i)
                                   (cons (nth 1 i) (car i)))
                                 (howm-recent-menu 100))))
         (type . file)))

 (setq anything-sources
       `(anything-c-source-buffers
         anything-c-source-imenu
         anything-c-source-file-name-history
         anything-c-source-info-pages
         anything-c-source-man-pages
         anything-c-source-locate
         anything-c-source-emacs-commands
         ,(if (featurep 'howm-mode) anything-c-source-howm-recent-menu))) )
