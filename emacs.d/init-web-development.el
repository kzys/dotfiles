
;; CSS
(autoload 'css-mode "css-mode" "Mode for editing CSS files" t)
(setq auto-mode-alist
      (cons '("\\.css$" . css-mode) auto-mode-alist))
(setq cssm-indent-function #'cssm-c-style-indenter)

;; JavaScript
(setq js2-cleanup-whitespace nil
      js2-mirror-mode nil
      js2-bounce-indent-flag t
      js2-auto-indent-flag nil
      js2-electric-keys nil)
(when (load "js2" t)
  ;;(setq-default js2-basic-offset 4)

  (defun indent-and-back-to-indentation ()
    (interactive)
    (indent-for-tab-command)
    (let ((point-of-indentation
           (save-excursion
             (back-to-indentation)
             (point))))
      (skip-chars-forward "\s " point-of-indentation)))

  (add-to-list 'auto-mode-alist '("\\.js$" . js2-mode)))

; (require 'espresso)
; (add-to-list 'auto-mode-alist '("\\.js$" . espresso-mode))

;; Reload
(add-hook 'after-save-hook 'reload-browsers)
(defun reload-browsers()
  (if (string-match "\.\\(css\\|js\\|html\\)[^/]*$" (buffer-name))
      (do-applescript "tell application \"Safari\" to do JavaScript \"location.reload(true)\" in document 1\n")))
(defun reload-browsers())


;; MozRepl
(autoload 'moz-minor-mode "moz" "Mozilla Minor and Inferior Mozilla Modes" t)
