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

