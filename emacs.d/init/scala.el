(let ((path
       (-newest-dir "~/src/scala-2.*" "/misc/scala-tool-support/emacs/")))
  (cond
   (path
    (add-to-list 'load-path path)
    (require 'scala-mode)
    (add-to-list 'auto-mode-alist '("\\.scala$" . scala-mode)))))
