;; -*- emacs-lisp -*-
;; ~/.emacs.el

(setq load-path
      (cons (expand-file-name "~/.emacs.d/lisp") load-path))

(setq user-mail-address "kzys@8-p.info")

(defmacro require-safety (symbol &rest body)
  `(cond ((require ,symbol nil t)
          ,@body)
         (t
          (message "Failed to load %s." ,symbol)) ))

(require 'un-define nil t)
(set-language-environment 'Japanese)
(prefer-coding-system 'utf-8-unix)
(set-keyboard-coding-system 'utf-8-unix)
(set-terminal-coding-system 'utf-8-unix)
(auto-compression-mode t)


;; http://steve.yegge.googlepages.com/effective-emacs
(global-set-key "\C-x\C-m" 'execute-extended-command)
(global-set-key "\C-c\C-m" 'execute-extended-command)

(global-set-key "\C-k" 'backward-kill-word)
(global-set-key "\C-x\C-k" 'kill-line)

(if window-system
    (tool-bar-mode -1))
(menu-bar-mode (if window-system 0 -1))

(defalias 'qrr 'query-replace-regexp)

(global-set-key [f5] 'call-last-kbd-macro)


(setq-default indent-tabs-mode nil
              tab-width 4)
(when (boundp 'show-trailing-whitespace)
  (setq-default show-trailing-whitespace t))

;; Misc
(global-set-key "\C-h" 'backward-delete-char-untabify)
(global-set-key "\C-ch" 'help)

(global-set-key "\C-cb" 'compile)
(global-set-key "\C-cg" 'grep)
(require-safety
 'color-moccur
 (global-set-key "\M-o" 'moccur))

(column-number-mode t)

(global-font-lock-mode t)

(set-cursor-color "black")
(blink-cursor-mode 0)

(put 'downcase-region 'disabled nil)

;; Dynamic Macro
(defconst *dmacro-key* "\C-c\C-d")
(global-set-key *dmacro-key* 'dmacro-exec)
(autoload 'dmacro-exec "dmacro" nil t)

;; Indent
(global-set-key "\C-m" 'newline-and-indent)
(global-set-key "\C-a" 'beggining-of-line-or-indented-line)
(defun beggining-of-line-or-indented-line (current-point)
  (interactive "d")
  (if (bolp)
      (back-to-indentation)
    (beginning-of-line)))

;; Window
(windmove-default-keybindings)

;; Bell
(setq ring-bell-function (lambda()))

;; Session
;; http://d.hatena.ne.jp/higepon/20061230/1167447339
(require-safety
 'session
 (setq session-initialize t)
 (setq session-save-file (expand-file-name "~/.emacs.d/session"))
 (setq session-globals-include '((kill-ring 50)
                                 (session-file-alist 500 t)
                                 (file-name-history 10000)))
 (setq session-globals-max-string 100000000)
 (setq history-length t)
 (add-hook 'after-init-hook 'session-initialize))

;; Server
(require 'server)
(server-start)

;; Region
(transient-mark-mode t)

;; Paren
(require-safety
 'mic-paren
 (paren-activate)
 (set-face-foreground 'paren-face-match "yellow")
 (set-face-background 'paren-face-match nil))

;; Tramp
(require-safety
 'tramp
 (add-to-list 'backup-directory-alist
              (cons tramp-file-name-regexp nil)))

(require-safety
 'haskell-mode
 (setq auto-mode-alist
       (cons '("\\.hs$" . haskell-mode) auto-mode-alist)))

;; Auto Insert
(setq auto-insert-directory  ;; don't forget last slash!
      (expand-file-name "~/.emacs.d/template/"))
(auto-insert-mode t)
(setq auto-insert-alist
      '(("\\.pl$" . "_.pl")
        ("\\.rb$" . "_.rb")))
(add-hook 'find-file-hooks 'auto-insert)
(setq auto-insert-query nil)

(if (not (functionp 'declare-function))
    (defmacro declare-function (&rest args)))

(mapcar
 (lambda (name)
   (load (expand-file-name (format "~/.emacs.d/init-%s.el" name))))
 (list
  "flymake"
  "version-control"
  "buffer"
  "howm"
  "anything"
  "c"
  "perl"
  "ruby"
  "scala"
  "web-development"))

(when (not window-system)
  (xterm-mouse-mode 1)
  (mouse-wheel-mode 1))

;; auto-complete
(require-safety
 'auto-complete
 (global-auto-complete-mode t)

 (mapcar (lambda (hook)
           (add-hook hook
                     '(lambda ()
                        (setq ac-sources '(ac-source-symbols)))))
         (list 'emacs-lisp-mode-hook 'lisp-interaction-mode-hook)) )

(load (expand-file-name "~/.emacs.d/lisp/local.el") t t)

(require 'wdired)
(define-key dired-mode-map "r" 'wdired-change-to-wdired-mode)

(require 'moccur-edit)

(defun my:test-current-buffer ()
  (interactive)
  (if (eq major-mode 'ruby-mode)
      (compile "rake test")))
(global-set-key "\C-c\C-t" 'my:test-current-buffer)
