(let ((dir (expand-file-name "~/src/scala-dist/tool-support/src/emacs/")))
  (cond
   ((file-exists-p dir)
    (add-to-list 'load-path dir)
    (require 'scala-mode)
    (add-to-list 'auto-mode-alist '("\\.scala$" . scala-mode)))))
