(let ((path
       (car (sort (remove-if-not 'file-directory-p
                          (file-expand-wildcards
                           (expand-file-name "~/src/scala-2.*")))
           (lambda (a b)
             (not (string-lessp a b)))))))
  (cond ((file-directory-p path)
         (setq load-path
               (cons (concat path "/misc/scala-tool-support/emacs/")
                     load-path))
         (require 'scala-mode)
         (setq auto-mode-alist
               (cons '("\\.scala$" . scala-mode) auto-mode-alist)))))

