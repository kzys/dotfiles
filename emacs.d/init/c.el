;; -*- Emacs-Lisp -*-
(require 'cc-mode)
(setq-default c-basic-offset 4)
(add-to-list 'c-default-style '(c-mode . "k&r"))
(c-add-style "mlterm" '((indent-tabs-mode . t)
                        (c-basic-offset . 4)) nil)
(add-hook 'c-mode-common-hook
		  '(lambda ()
             (if (and (string-match "/mlterm/" buffer-file-name)
                      (not (string-match "/mac/" buffer-file-name)))
               (c-set-style "mlterm"))))

;; Objective-C and Objective-C++
(add-to-list 'auto-mode-alist '("\\.mm?$" . objc-mode))
(defun objc-header-file-p ()
  (save-excursion
    (search-forward "@end" nil t)))
(add-to-list 'magic-mode-alist
             '(objc-header-file-p . objc-mode))
(require-safety
 'objc-c-mode
 (add-to-list 'c-default-style '(objc-mode . "objc")))

;; Easy-to-switch header and impl.
(define-key c-mode-base-map "\C-c\C-n" 'ff-find-other-file)
(setq cc-other-file-alist
      '(("\\.mm?$" (".h"))
        ("\\.h$" (".c" ".cpp" ".m" ".mm"))))

;; Arduino
(add-to-list 'auto-mode-alist '("\\.pde$" . c++-mode))

