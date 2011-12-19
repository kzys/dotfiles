(defun -newest-dir (pattern subdir)
  (let* ((dirs (file-expand-wildcards (expand-file-name pattern)))
         (path (car (sort (remove-if-not 'file-directory-p dirs)
                          (lambda (a b)
                            (not (string-lessp a b)))))))
    (if path (concat path subdir) nil)))

(let ((path
       (-newest-dir "~/src/scala-2.*" "/misc/scala-tool-support/emacs/")))
  (cond
   (path
    (add-to-list 'load-path path)
    (require 'scala-mode)
    (add-to-list 'auto-mode-alist '("\\.scala$" . scala-mode)))))
