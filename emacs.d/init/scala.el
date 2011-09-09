(let* ((dirs (file-expand-wildcards
             (expand-file-name "~/src/scala-2.*")))
       (path (car (sort (remove-if-not 'file-directory-p dirs)
                        (lambda (a b)
                          (not (string-lessp a b)))))))
  (cond (path
         (add-to-list 'load-path
                      (concat path "/misc/scala-tool-support/emacs/"))
         (require 'scala-mode)
         (add-to-list 'auto-mode-alist
                      '("\\.scala$" . scala-mode)))))
