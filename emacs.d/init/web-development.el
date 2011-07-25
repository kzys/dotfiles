
;; CSS
(autoload 'css-mode "css-mode" "Mode for editing CSS files" t)
(setq auto-mode-alist
      (cons '("\\.css$" . css-mode) auto-mode-alist))
(setq cssm-indent-function #'cssm-c-style-indenter)

;; Reload
(add-hook 'after-save-hook 'reload-browsers)
(defun reload-browsers()
  (if (string-match "\.\\(css\\|js\\|html\\)[^/]*$" (buffer-name))
      (do-applescript "tell application \"Safari\" to do JavaScript \"location.reload(true)\" in document 1\n")))
(defun reload-browsers())


;; MozRepl
(autoload 'moz-minor-mode "moz" "Mozilla Minor and Inferior Mozilla Modes" t)
