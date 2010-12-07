;; Anything

(setq anything-command-map-prefix-key "C-^")

(require 'anything)
(require 'anything-config)
(require 'anything-project)
(require 'anything-match-plugin)

(defun anything-switch-to-buffer ()
  (interactive)
  (anything-other-buffer
   (list 'anything-c-source-buffers
         'anything-c-source-recentf
         'anything-c-source-files-in-current-dir
         (if (car (ap:get-root-directory))
             'anything-c-source-project))
   "*anything switch-to-buffer*"))
(global-set-key "\C-xb" 'anything-switch-to-buffer)

(define-anything-type-attribute 'file
  '((action . (("Find File" . find-file)
               ("Find File (interactively)" .
                (lambda (file)
                  (find-file (read-file-name "Find file: " file file))))
               ("Delete File" .
                (lambda (file)
                  (if (y-or-n-p (format "Really delete file %s? " file))
                      (delete-file file))))))))

(defun anything-select-action-or-execute-2nd-action ()
  (interactive)
  (when (get-buffer-window anything-action-buffer 'visible)
    (anything-next-line)
    (exit-minibuffer))
  (anything-select-action))
(define-key anything-map "\t" 'anything-select-action-or-execute-2nd-action)
