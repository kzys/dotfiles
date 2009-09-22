(setq load-path
      (cons (expand-file-name "~/src/scala-2.7.4.final/misc/scala-tool-support/emacs/") load-path))
(require 'scala-mode)

(setq auto-mode-alist
      (cons '("\\.scala$" . scala-mode) auto-mode-alist))
