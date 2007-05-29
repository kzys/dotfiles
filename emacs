;; ~/.emacs.el
(setq load-path (cons (expand-file-name "~/.emacs.d/lisp") load-path))
(setq user-mail-address "kzys@8-p.info")
(set-language-environment 'Japanese)

;; Misc
(column-number-mode t)
(tool-bar-mode nil)

(global-font-lock-mode t)

(set-cursor-color "black")
(blink-cursor-mode 0)

;; Indent
(setq-default indent-tabs-mode nil)
(global-set-key "\r" 'newline-and-indent)

(global-set-key "\C-ch" 'help)

(put 'downcase-region 'disabled nil)

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

;; Paren
(when (require 'mic-paren nil t)
  (paren-activate)
  (set-face-foreground 'paren-face-match "#ccc")
  (set-face-background 'paren-face-match nil))

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

(setq c-default-style "k&r")

(add-hook 'c-mode-common-hook
          '(lambda ()
             (progn
               (setq indent-width 4
                     c-basic-offset 4
                     indent-tabs-mode nil))))

(add-hook 'c++-mode-hook
  (function (lambda ()
              (define-key c++-mode-map "\C-c\C-p" 'ff-find-other-file)
              (define-key c++-mode-map "\C-c\C-n" 'ff-find-other-file))))
(setq auto-mode-alist
      (append '(("\\.mm?$" . objc-mode)) auto-mode-alist))



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
(add-to-list 'auto-mode-alist '("\\.js\\'" . javascript-mode))
(add-to-list 'auto-mode-alist '("\\.as\\'" . javascript-mode))
(autoload 'javascript-mode "javascript" nil t)

;; Reload
(add-hook 'after-save-hook 'reload-browsers)
(defun reload-browsers() 
  (if (string-match "\.\\(css\\|js\\|html\\)[^/]*$" (buffer-name))
      (do-applescript "tell application \"Safari\" to do JavaScript \"location.reload(true)\" in document 1\n")))
(defun reload-browsers())


;; Window System
(if (not window-system)
    (menu-bar-mode nil))

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
