(let ((path (expand-file-name "~/src/scala-2.7.6.final")))
  (cond ((file-directory-p path)
         (setq load-path
               (cons (concat path "/misc/scala-tool-support/emacs/")
                     load-path))
         (require 'scala-mode)
         (setq auto-mode-alist
               (cons '("\\.scala$" . scala-mode) auto-mode-alist)))))
