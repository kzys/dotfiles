;; Anything
(setq anything-c-use-standard-keys t)
(setq anything-command-map-prefix-key "C-^")
(require 'image) ; image-load-path
(require 'anything-config)

(require 'anything-project)
(global-set-key "\C-c\C-f" 'anything-project)


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

(setq anything-c-source-buffers++
  '((name . "Buffers")
    (candidates . anything-c-buffer-list)
    (volatile)
    (type . buffer)
    (candidate-transformer anything-c-skip-current-buffer
                           anything-c-skip-boring-buffers)
    (persistent-action . anything-c-buffers+-persistent-action)))

(setq anything-sources
       `(anything-c-source-buffers++
         anything-c-source-imenu
         anything-c-source-file-name-history
         anything-c-source-info-pages
         anything-c-source-man-pages
         anything-c-source-locate
         anything-c-source-emacs-commands
         ,(if (featurep 'howm-mode) anything-c-source-howm-recent-menu)))

