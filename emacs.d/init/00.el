;; This file contains very basic settings of Emacs.
;; I can recommend them for my coworkers (especially a newbie).

(require 'package)
(add-to-list 'package-archives
             '("melpa" . "http://melpa.org/packages/"))
(package-initialize)

;; C-h should be "delete" because it's very common convention in Unix.
(global-set-key "\C-h" 'backward-delete-char-untabify)
(global-set-key "\C-ch" 'help)

;; On Emacs, C-n and C-p is "up" and "down".
;; But in Minibuffer, default settings break this convention.
(mapcar (lambda (keymap)
	  (define-key keymap "\C-n" 'next-history-element)
	  (define-key keymap "\C-p" 'previous-history-element))
	(list minibuffer-local-map
	      minibuffer-local-ns-map
	      minibuffer-local-completion-map))

;; "Region" should be visible.
(transient-mark-mode t)

;; perl-mode can't handle some syntax of Perl.
;; I recommend that you use cperl-mode.
(setq auto-mode-alist
      (append '(("\\.p[lm]$" . cperl-mode)
                ("\\.t$" . cperl-mode)) auto-mode-alist))
(add-to-list 'interpreter-mode-alist
             '("perl" . cperl-mode))

;; But cperl-mode's default settings is not so good.
;; I prefer "Perl Best Practices" 2.11.
(setq cperl-close-paren-offset -4
      cperl-continued-statement-offset 4
      cperl-indent-level 4
      cperl-indent-parens-as-block t
      cperl-tab-always-indent t)

;; Show "matched" parenthesis.
(show-paren-mode 1)

;; Shouldn't use "hard tab" on code.
(setq-default indent-tabs-mode nil)
(setq-default tab-width 4)

;; Flymake
(require 'flymake)
(require 'flymake-cursor)

;; You can use Menu even if you don't use any window system.
;; But it's not useful.
(menu-bar-mode (if window-system 1 -1))

;; Tool Bar is not useful in Emacs.
(if (boundp 'tool-bar-mode)
    (tool-bar-mode -1))

;; I can see a cursor even if it doesn't blink.
(blink-cursor-mode -1)

;; Server
(require 'server)
(server-start)

;; When I open two files which have same basename,
;; Emacs should not name as "foo<1>", "foo<2>".
(require 'uniquify)
(setq uniquify-buffer-name-style 'post-forward-angle-brackets)

(cond
 (window-system
  (let ((family "Menlo")
        (size 14))
    (set-default-font (format "%s-%d" family size))
    (set-face-font 'default
                   (format "%s-%d" family size))
    (set-face-font 'bold
                   (format "%s-%d:weight=bold" family size))
    (set-face-font 'italic
                   (format "%s-%d:slant=oblique" family size))
    (set-face-font 'bold-italic
                   (format "%s-%d:weight=bold:slant=oblique" family size))
    (set-scroll-bar-mode 'right))))

(ido-mode 'buffers)

;; Show where is the Emacs
(defun my-parse-lsb-release (path)
  (let* ((content
          (with-temp-buffer
           (insert-file-contents path)
           (buffer-string)))
         (lines (split-string content "\n")))
    (mapcar
     (lambda (line)
       (let ((xs (split-string line "=")))
         (cons (car xs) (cadr xs))))
     lines)))

(defun my-lsb-release ()
  (if (file-exists-p "/etc/lsb-release")
      (my-parse-lsb-release "/etc/lsb-release")))

(let ((distrib
       (if (file-exists-p "/System/Library/CoreServices/Finder.app")
           "OS X"
         (cdr (assoc "DISTRIB_ID" (my-lsb-release))))))
  (setq frame-title-format
        (list
         "%b - "              ;; foobar.el
         (system-name)        ;; baz.example.com
         " (" distrib ")")))  ;; OS X / Ubuntu
