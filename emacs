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
       (let ((ascii "Menlo")
             (japanese "Hiragino Kaku Gothic ProN"))
         (set-face-attribute 'default nil
                             :family ascii
                             :height 140)
         (let ((spec (font-spec :family ascii)))
           (set-fontset-font nil '(#x0080 . #x024F) spec)
           (set-fontset-font nil '(#x0370 . #x03FF) spec))
         (let ((spec (font-spec :family japanese)))
           (set-fontset-font nil 'japanese-jisx0213.2004-1 spec)
           (set-fontset-font nil 'japanese-jisx0213-2 spec)
           (set-fontset-font nil 'katakana-jisx0201 spec)))))


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

