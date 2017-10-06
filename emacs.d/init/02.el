(when (boundp 'show-trailing-whitespace)
  (setq-default show-trailing-whitespace t))

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

(menu-bar-mode -1)
(mouse-wheel-mode 1)

(defalias 'qrr 'query-replace-regexp)

(global-set-key [f5] 'call-last-kbd-macro)


;; Misc

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

;; Tramp
(require-safety
 'tramp
 (add-to-list 'backup-directory-alist
              (cons tramp-file-name-regexp nil)))

(require-safety
 'haskell-mode
 (setq auto-mode-alist
       (cons '("\\.hs$" . haskell-mode) auto-mode-alist)))

(load (expand-file-name "~/.emacs.d/lisp/local.el") t t)

(require 'wdired)
(define-key dired-mode-map "r" 'wdired-change-to-wdired-mode)

(defun my:test-current-buffer ()
  (interactive)
  (if (eq major-mode 'ruby-mode)
      (compile "rake test")))
(global-set-key "\C-c\C-t" 'my:test-current-buffer)
