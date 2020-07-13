;; -*- emacs-lisp -*-
;; ~/.emacs.el
(setq debug-on-error t)

;; Added by Package.el.  This must come before configurations of
;; installed packages.  Don't delete this line.  If you don't want it,
;; just comment it out by adding a semicolon to the start of the line.
;; You may delete these explanatory comments.
(package-initialize)

; desktop instead of session
(desktop-save-mode 1)
(setq desktop-save t)

; keep all backup files under ~/.emacs.d/
(make-directory "~/.emacs.d/backup" t)
(setq backup-directory-alist `(("." "~/.emacs.d/backup")))

(let ((dir (expand-file-name "~/.emacs.d/init/")))
  (mapcar
   (lambda (basename)
     (message basename)
     (if (string-match "\\.el$" basename)
         (load (concat dir basename))))
   (sort (directory-files dir) 'string-lessp)))

(cond ((eq window-system 'ns)
       (set-cursor-color "#ccc")

       (set-frame-parameter (selected-frame) 'alpha '(95 95))
       (add-to-list 'default-frame-alist '(alpha 95 95))

       (defun insert-backslash ()
         (interactive)
         (insert "\\"))
       (global-set-key "¥" 'insert-backslash)

       (mapcar
        (lambda (face)
          (set-face-attribute face nil :family "Menlo" :height 120))
        (list 'default 'bold 'bold-italic))

       (mapcar
        (lambda (target)
          (set-fontset-font
           (frame-parameter nil 'font)
           target
           '("Hiragino Maru Gothic Pro" . "iso10646-1")))
        (list 'japanese-jisx0208 'japanese-jisx0212))))

(setq ispell-local-dictionary "english")
(setq ispell-program-name
      (if (file-exists-p "/usr/local/bin/aspell")
          "/usr/local/bin/aspell" "aspell"))

(setq user-full-name "Kato Kazuyoshi"
      user-mail-address "kato.kazuyoshi@gmail.com")

(setq gnus-select-method
      '(nnimap "gmail"
	       (nnimap-address "imap.gmail.com")
	       (nnimap-server-port 993)
	       (nnimap-authinfo-file "~/.emacs.d/authinfo")
	       (nnimap-stream ssl)))

(setq message-send-mail-function 'smtpmail-send-it
      send-mail-function 'smtpmail-send-it
      smtpmail-debug-info t

      smtpmail-default-smtp-server "smtp.gmail.com"
      smtpmail-smtp-server "smtp.gmail.com"
      smtpmail-smtp-service 587
      smtpmail-starttls-credentials '(("smtp.gmail.com" 587 nil nil))

      smtpmail-auth-credentials (expand-file-name "~/.emacs.d/authinfo"))

(cond
 ((require 'anthy nil t)

  (require 'egg)
  (setq default-input-method 'japanese-egg-anthy)

  (require 'egg-mlh)
  (setq mlh-default-backend "anthy")
  (global-set-key " " 'mlh-space-bar-backward-henkan)))
(custom-set-variables
 ;; custom-set-variables was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 '(haskell-mode-hook (quote (turn-on-haskell-indent)))
 '(magit-credential-cache-daemon-socket nil)
 '(package-selected-packages
   (quote
    (rust-mode session scala-mode minibuf-isearch magit go-mode flymake-cursor dsvn)))
 '(session-use-package t nil (session)))
(custom-set-faces
 ;; custom-set-faces was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 )
