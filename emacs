;; -*- emacs-lisp -*-
;; ~/.emacs.el

(let ((dir (expand-file-name "~/.emacs.d/init/")))
  (mapcar
   (lambda (basename)
     (message basename)
     (if (string-match "\\.el$" basename)
         (load (concat dir basename))))
   (sort (directory-files dir) 'string-lessp)))

(cond ((eq window-system 'ns)
       (mapcar
        (lambda (face)
          (set-face-attribute face nil :family "Menlo" :height 140))
        (list 'default 'bold 'bold-italic))

       (mapcar
        (lambda (target)
          (set-fontset-font
           (frame-parameter nil 'font)
           target
           '("Hiragino Maru Gothic Pro" . "iso10646-1")))
        (list 'japanese-jisx0208 'japanese-jisx0212))))


(setq ispell-program-name "/usr/local/bin/aspell")

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

