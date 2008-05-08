;; -*- emacs-lisp -*-
;; ~/.emacs.el

(setq load-path
      (cons (expand-file-name "~/.emacs.d/lisp") load-path))

(setq user-mail-address "kzys@8-p.info")

(require 'un-define nil t)
(set-language-environment 'Japanese)
(prefer-coding-system 'utf-8-unix)
(set-keyboard-coding-system 'utf-8-unix)
(set-terminal-coding-system 'utf-8-unix)
(auto-compression-mode t)

(setq-default indent-tabs-mode nil
              tab-width 4)
(when (boundp 'show-trailing-whitespace)
  (setq-default show-trailing-whitespace t))

;; Misc
(global-set-key "\C-h" 'backward-delete-char-untabify)
(global-set-key "\C-ch" 'help)

(global-set-key "\C-cb" 'compile)
(global-set-key "\C-cg" 'grep)
(global-set-key "\C-co" 'occur)

(column-number-mode t)
(tool-bar-mode -1)
(menu-bar-mode (if window-system 0 -1))

(global-font-lock-mode t)

(set-cursor-color "black")
(blink-cursor-mode 0)

(put 'downcase-region 'disabled nil)

;; Dynamic Macro
(defconst *dmacro-key* "\C-c\C-d")
(global-set-key *dmacro-key* 'dmacro-exec)
(autoload 'dmacro-exec "dmacro" nil t)

;; Indent
(global-set-key "\r" 'newline-and-indent)
(global-set-key "\C-a" 'beggining-of-line-or-indented-line)
(defun beggining-of-line-or-indented-line (current-point)
  (interactive "d")
  (if (bolp)
      (back-to-indentation)
    (beginning-of-line)))

;; Buffer
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
  (setq svn-status-svn-environment-var-list '("LANG=ja_JP.UTF-8"))
  (global-set-key "\C-cv" 'svn-status))

;; Mercurial
;; installed on ~/local
(setq exec-path
      (cons (expand-file-name "~/local/bin") exec-path))
(setenv "PYTHONPATH" (expand-file-name "~/local/lib/python"))

(when (require 'vc-hg nil t)
 (setq vc-handled-backends (cons 'HG vc-handled-backends)))

;; Tramp
(when (require 'tramp nil t)
  (add-to-list 'backup-directory-alist
               (cons tramp-file-name-regexp nil)))

;; Ruby
(autoload 'ruby-mode "ruby-mode"
  "Mode for editing ruby source files" t)
(setq auto-mode-alist
      (cons '("\\.rb$" . ruby-mode) auto-mode-alist))
(setq interpreter-mode-alist
      (cons '("ruby" . ruby-mode) interpreter-mode-alist))
(autoload 'run-ruby "inf-ruby"
  "Run an inferior Ruby process")
(autoload 'inf-ruby-keys "inf-ruby"
  "Set local key defs for inf-ruby in ruby-mode")
(add-hook 'ruby-mode-hook
          '(lambda ()
            (inf-ruby-keys)))

;; C
(require 'cc-mode)
(c-add-style "mlterm" '((indent-tabs-mode . t)
                        (c-basic-offset . 4)) nil)
(setq c-default-style '((c-mode . "k&r")))

(add-hook 'c-mode-common-hook
		  '(lambda ()
             (if (and (string-match "/mlterm/" buffer-file-name)
                      (not (string-match "/mac/" buffer-file-name)))
                 (c-set-style "mlterm")
               (c-set-style "k&r")
               (setq indent-tabs-mode nil
                     indent-width 4
                     c-basic-offset 4))))
(define-key c-mode-base-map "\C-c\C-n" 'ff-find-other-file)

;; Objective-C and Objective-C++
(when (require 'objc-c-mode nil t)
  (setq c-default-style
        (cons '(objc-mode . "objc") c-default-style)

        auto-mode-alist
        (cons '("\\.mm?$" . objc-mode) auto-mode-alist)))

;; C++
(setq auto-mode-alist
      (cons '("\\.h$" . c++-mode) auto-mode-alist))

(setq cc-other-file-alist
      '(("\\.mm?$" (".h"))
        ("\\.h$" (".c" ".cpp" ".m" ".mm"))))

(when (require 'haskell-mode nil t)
  (setq auto-mode-alist
        (cons '("\\.hs$" . haskell-mode) auto-mode-alist)))

;; CSS
(autoload 'css-mode "css-mode" "Mode for editing CSS files" t)
(setq auto-mode-alist
      (cons '("\\.css$" . css-mode) auto-mode-alist))
(setq cssm-indent-function #'cssm-c-style-indenter)

;; JavaScript
(require 'js2-mode nil t)
(add-to-list 'auto-mode-alist '("\\.js\\'" . js2-mode))

;; Reload
(add-hook 'after-save-hook 'reload-browsers)
(defun reload-browsers()
  (if (string-match "\.\\(css\\|js\\|html\\)[^/]*$" (buffer-name))
      (do-applescript "tell application \"Safari\" to do JavaScript \"location.reload(true)\" in document 1\n")))
(defun reload-browsers())

;; Howm
(setq load-path
      (cons (expand-file-name "~/local/share/emacs/site-lisp/howm") load-path))
(autoload 'howm-menu "howm" "Hitori Otegaru Wiki Modoki" t)
(global-set-key "\C-c,," 'howm-menu)
(setq howm-menu-lang 'ja)
(setq howm-template "= <<< %title%cursor\n\n")
(setq howm-menu-expiry-hours 2)
(setq howm-menu-refresh-after-save nil)

;; MozRepl
(autoload 'moz-minor-mode "moz" "Mozilla Minor and Inferior Mozilla Modes" t)

;; Flymake
(require 'flymake)

;; Auto Insert
(setq auto-insert-directory  ;; don't forget last slash!
      (expand-file-name "~/.emacs.d/template/"))
(auto-insert-mode t)
(setq auto-insert-alist
      '(("\\.pl$" . "_.pl")
        ("\\.rb$" . "_.rb")))
(add-hook 'find-file-hooks 'auto-insert)
(setq auto-insert-query nil)

;; Anything
(setq anything-c-use-standard-keys t)
(when (require 'anything-config nil t)
  (global-set-key "\C-xb" 'anything)

  (setq anything-type-attributes
        '((file (action . (("Find File" . find-file)
                           ("Find File?" . (lambda (file)
                                             (find-file (read-file-name "Find file: " file file t))))
                           ("Delete File" . (lambda (file)
                                              (if (y-or-n-p (format "Really delete file %s? "
                                                                    file))
                                                  (delete-file file)))))))
          (buffer (action . (("Switch to Buffer" . switch-to-buffer)
                             ("Pop to Buffer"    . pop-to-buffer)
                             ("Display Buffer"   . display-buffer)
                             ("Kill Buffer"      . kill-buffer))))))

  (defun anything-select-action-or-execute-2nd-action ()
    (interactive)
    (when anything-saved-sources
      (anything-next-line) ;; FIXME: fragile...
      (exit-minibuffer))
    (anything-select-action))
  (define-key anything-map "\t" 'anything-select-action-or-execute-2nd-action)

  (setq anything-sources
      (list anything-c-source-buffers
            anything-c-source-calculation-result
            anything-c-source-file-name-history
            anything-c-source-info-pages
            anything-c-source-man-pages
            anything-c-source-locate
            anything-c-source-emacs-commands)))


;; Perl
(setq auto-mode-alist
      (append '(("\\.p[lm]$" . cperl-mode)
                ("\\.t$" . cperl-mode)) auto-mode-alist))
;; Perl Best Practices 2.11
(setq cperl-close-paren-offset -4
      cperl-continued-statement-offset 4
      cperl-indent-level 4
      cperl-indent-parens-as-block t
      cperl-tab-always-indent t)

;; Mac
(if (eq window-system 'mac)
    (progn
      (modify-frame-parameters nil
                               '((top . 0)
                                 (width . 100)
                                 (height . 40)))

      (setenv "PATH"
              (concat (expand-file-name "~/bin") ":" (getenv "PATH")))

      (set-default-coding-systems 'utf-8-unix)
      (set-terminal-coding-system 'utf-8)
      (set-keyboard-coding-system 'sjis-mac)
      (set-clipboard-coding-system 'sjis-mac)
      (set-file-name-coding-system 'utf-8)

      (set-face-background 'region "#ccc")

      ;; Font
      (create-fontset-from-mac-roman-font
       "-apple-monaco-medium-r-normal--14-*-*-*-*-*-iso10646-1"
       nil "monospace")
      (set-fontset-font "fontset-monospace"
                        'japanese-jisx0208
                        '("ヒラギノ角ゴ pro w4*" . "jisx0208.*"))
      (set-fontset-font "fontset-monospace"
                        'katakana-jisx0201
                        '("ヒラギノ角ゴ pro w4*" . "jisx0201.*"))
      (set-frame-font "fontset-monospace")

      (mac-input-method-mode t)

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

