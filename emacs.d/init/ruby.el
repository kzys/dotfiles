(let ((path
       (-newest-dir "~/src/ruby-1.9.*" "/misc")))
  (cond
   (path
    (add-to-list 'load-path path)
    (require 'ruby-mode)
    (add-to-list 'auto-mode-alist '("\\.rb$" . ruby-mode))
    (setq interpreter-mode-alist
      (cons '("ruby" . ruby-mode) interpreter-mode-alist)) )))
