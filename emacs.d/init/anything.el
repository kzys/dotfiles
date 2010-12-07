;; Anything

(setq anything-command-map-prefix-key "C-^")

(require 'anything)
(require 'anything-config)
(global-set-key "\C-xb" 'anything)

(require 'anything-match-plugin)

(require 'anything-project)
(defun find-file-or-anything-project ()
  (interactive)
  (call-interactively
   (if (car (ap:get-root-directory))
       'anything-project
     'find-file)))
(global-set-key "\C-x\C-f" 'find-file-or-anything-project)

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
