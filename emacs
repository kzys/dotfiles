;; ~/.emacs.el
(setq load-path (cons (expand-file-name "~/.emacs.d/lisp") load-path))
(setq user-mail-address "kzys@8-p.info")

(require 'un-define nil t)
(set-language-environment 'Japanese)
(prefer-coding-system 'utf-8-unix)
(set-keyboard-coding-system 'utf-8-unix)
(set-terminal-coding-system 'utf-8-unix)
(auto-compression-mode t)


;; Misc
(global-set-key "\C-ch" 'help)
(global-set-key "\C-cb" 'compile)
(global-set-key "\C-h" 'backward-delete-char-untabify)

(column-number-mode t)
(tool-bar-mode nil)

(global-font-lock-mode t)

(set-cursor-color "black")
(blink-cursor-mode 0)

(put 'downcase-region 'disabled nil)

;; Dynamic Macro
(defconst *dmacro-key* "\C-c\C-d")
(global-set-key *dmacro-key* 'dmacro-exec)
(autoload 'dmacro-exec "dmacro" nil t)

(when (boundp 'show-trailing-whitespace)
  (setq-default show-trailing-whitespace t))

;; Indent
(global-set-key "\r" 'newline-and-indent)
(global-set-key "\C-a" 'beggining-of-line-or-indented-line)
(defun beggining-of-line-or-indented-line (current-point)
  (interactive "d")
  (if (bolp)
      (back-to-indentation)
    (beginning-of-line)))
(defun indent-line-or-dabbrev-expand ()
  (interactive)
  (if (save-excursion
        (backward-char 1)
        (looking-at "[-A-Za-z]"))
      (if (string-match "lisp" (symbol-name major-mode))
          (lisp-complete-symbol)
        (dabbrev-expand nil))
    (indent-according-to-mode)))

(global-set-key "\t" 'indent-line-or-dabbrev-expand)
(define-key lisp-mode-shared-map "\t" 'indent-line-or-dabbrev-expand)

;; Buffer
(iswitchb-mode t)
(require 'uniquify)
(setq uniquify-buffer-name-style 'post-forward-angle-brackets)

;; Window
(windmove-default-keybindings)

;; Bell
(setq ring-bell-function (lambda()))

;; Session
;; http://d.hatena.ne.jp/higepon/20061230/1167447339
(when (require 'session nil t)
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

;; Minibuffer
(require 'minibuf-isearch nil t)
(mapcar (lambda (keymap)
          (define-key keymap "\C-n" 'next-history-element)
          (define-key keymap "\C-p" 'previous-history-element))
        (list minibuffer-local-map minibuffer-local-ns-map minibuffer-local-completion-map))

;; Paren
(when (require 'mic-paren nil t)
  (paren-activate)
  (set-face-foreground 'paren-face-match "#ccc")
  (set-face-background 'paren-face-match nil))

;; Subversion
(when (require 'psvn nil t)
  (add-to-list 'exec-path "/sw/bin"))

;; Tramp
(when (require 'tramp nil t)
  (add-to-list 'backup-directory-alist
               (cons tramp-file-name-regexp nil)))

;; Ruby
(autoload 'ruby-mode "ruby-mode"
  "Mode for editing ruby source files" t)
(setq auto-mode-alist
      (append '(("\\.rb$" . ruby-mode)) auto-mode-alist))
(setq interpreter-mode-alist (append '(("ruby" . ruby-mode))
                                     interpreter-mode-alist))
(autoload 'run-ruby "inf-ruby"
  "Run an inferior Ruby process")
(autoload 'inf-ruby-keys "inf-ruby"
  "Set local key defs for inf-ruby in ruby-mode")
(add-hook 'ruby-mode-hook
          '(lambda ()
            (inf-ruby-keys)))

;; C
(require 'cc-mode)

(setq-default indent-tabs-mode nil)
(add-hook 'c-mode-common-hook
  (function (lambda ()
	      (setq indent-width 4
		       c-basic-offset 4
		       indent-tabs-mode nil)
              (define-key c-mode-base-map "\C-c\C-n" 'ff-find-other-file))))

;; Objective-C and Objective-C++
(when (require 'objc-c-mode nil t)
  (setq auto-mode-alist
	(append '(("\\.mm?$" . objc-mode)) auto-mode-alist)))

;; C++
(setq auto-mode-alist
      (append '(("\\.h$" . c++-mode)) auto-mode-alist))

(setq c-default-style '((objc-mode . "objc")
			(c-mode . "k&r")))
(setq c-default-style '((objc-mode . "objc")
			(c-mode . "k&r")))
(setq cc-other-file-alist
      '(("\\.mm?$" (".h"))
	("\\.h$" (".c" ".cpp" ".m" ".mm"))))

(when (require 'haskell-mode nil t)
  (setq auto-mode-alist
        (append '(("\\.hs$" . haskell-mode)) auto-mode-alist)))

;; CSS
(autoload 'css-mode "css-mode" "Mode for editing CSS files" t)
(setq auto-mode-alist
      (append '(("\\.css$" . css-mode))
              auto-mode-alist))
(setq cssm-indent-function #'cssm-c-style-indenter)

;; JavaScript and ActionScript
(autoload 'javascript-mode "javascript" nil t)
(add-to-list 'auto-mode-alist '("\\.js\\'" . javascript-mode))
(add-to-list 'auto-mode-alist '("\\.as\\'" . java-mode))

;; Reload
(add-hook 'after-save-hook 'reload-browsers)
(defun reload-browsers()
  (if (string-match "\.\\(css\\|js\\|html\\)[^/]*$" (buffer-name))
      (do-applescript "tell application \"Safari\" to do JavaScript \"location.reload(true)\" in document 1\n")))
(defun reload-browsers())


;; Window System
(if (not window-system)
    (progn
;;       (set-face-foreground 'font-lock-keyword-face "magenta")
;;       (set-face-foreground 'font-lock-constant-face "black")
;;       (set-face-foreground 'font-lock-comment-face "green")
;;       (set-face-foreground 'font-lock-string-face "blue")
      (menu-bar-mode nil)))

(if (eq window-system 'mac)
    (progn
      (setq default-frame-alist
            (append (list '(width . 90)
                          '(height . 20))
		    default-frame-alist))


      (setenv "PATH"
              (concat (expand-file-name "~/bin") ":" (getenv "PATH")))

      (set-default-coding-systems 'utf-8-unix)
      (set-terminal-coding-system 'utf-8)
      (set-keyboard-coding-system 'sjis-mac)
      (set-clipboard-coding-system 'sjis-mac)
      (set-file-name-coding-system 'utf-8)

      (set-face-background 'region "#ccc")

      (require 'carbon-font)

      (set-default-font
       "-*-*-medium-r-normal--14-*-*-*-*-*-fontset-hiraginokaku")

      (add-to-list
       'default-frame-alist
       '(font . "-*-*-medium-r-normal--14-*-*-*-*-*-fontset-hiraginokaku"))

      (setq mac-allow-anti-aliasing t)

      (setq mac-command-key-is-meta nil)
      (global-set-key [(alt c)] 'kill-ring-save)
      (global-set-key [(alt v)] 'yank)
      (global-set-key [(alt x)] 'kill-region)
      (global-set-key [(alt a)] 'mark-whole-buffer)
      (global-set-key [(alt z)] 'undo)
      (global-set-key [(alt f)] 'isearch-forward)
      (global-set-key [(alt o)] 'find-file)
      (global-set-key [(alt s)] 'save-buffer)
      (global-set-key [(alt w)] 'kill-this-buffer)
      (global-set-key [(alt q)] 'save-buffers-kill-emacs)
      (global-set-key [(alt .)] 'keyboard-quit)
      (global-set-key [(alt up)] 'beginning-of-buffer)
      (global-set-key [(alt down)] 'end-of-buffer)
      (global-set-key [(alt left)] 'beginning-of-line)
      (global-set-key [(alt right)] 'end-of-line)
      (global-set-key [(alt b)] 'compile)))


;; Company
(if (string-match "ce-lab\.net$" (or (getenv "HOSTNAME") ""))
	(progn
	  (setq-default tab-width 4)
	  (add-hook 'c-mode-common-hook
				'(lambda ()
				   (setq indent-tabs-mode t)))))

