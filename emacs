;; -*- emacs-lisp -*-
;; ~/.emacs.el

(setq load-path
      (cons (expand-file-name "~/.emacs.d/lisp") load-path))

(setq user-mail-address "kzys@8-p.info")

(defun require-safety (symbol &rest body)
  (when (require symbol nil t)
    body))

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
(require-safety
 'color-moccur
 (global-set-key "\M-o" 'moccur))

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
(global-set-key "\C-m" 'newline-and-indent)
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

;; VC
(setq vc-follow-symlinks t)

;; Subversion
(when (require 'dsvn nil t)
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
(setq-default c-basic-offset 4)
(add-to-list 'c-default-style '(c-mode . "k&r"))
(c-add-style "mlterm" '((indent-tabs-mode . t)
                        (c-basic-offset . 4)) nil)
(add-hook 'c-mode-common-hook
		  '(lambda ()
             (if (and (string-match "/mlterm/" buffer-file-name)
                      (not (string-match "/mac/" buffer-file-name)))
               (c-set-style "mlterm"))))

;; Objective-C and Objective-C++
(add-to-list 'auto-mode-alist '("\\.mm?$" . objc-mode))
(defun objc-header-file-p ()
  (save-excursion
    (search-forward "@end" nil t)))
(add-to-list 'magic-mode-alist
             '(objc-header-file-p . objc-mode))
(when (require 'objc-c-mode nil t)
  (add-to-list 'c-default-style '(objc-mode . "objc")))

;; Easy-to-switch header and impl.
(define-key c-mode-base-map "\C-c\C-n" 'ff-find-other-file)
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
(when (load "js2" t)
  ;;(setq-default js2-basic-offset 4)

  (setq js2-cleanup-whitespace nil
        js2-mirror-mode nil
        js2-bounce-indent-flag nil)

  (defun indent-and-back-to-indentation ()
    (interactive)
    (indent-for-tab-command)
    (let ((point-of-indentation
           (save-excursion
             (back-to-indentation)
             (point))))
      (skip-chars-forward "\s " point-of-indentation)))
  (define-key js2-mode-map "\C-i" 'indent-and-back-to-indentation)

  (define-key js2-mode-map "\C-m" nil)

  (add-to-list 'auto-mode-alist '("\\.js$" . js2-mode)))

;; Reload
(add-hook 'after-save-hook 'reload-browsers)
(defun reload-browsers()
  (if (string-match "\.\\(css\\|js\\|html\\)[^/]*$" (buffer-name))
      (do-applescript "tell application \"Safari\" to do JavaScript \"location.reload(true)\" in document 1\n")))
(defun reload-browsers())

;; Howm
(setq load-path
      (cons (expand-file-name "~/local/share/emacs/site-lisp/howm") load-path))
(require-safety
 'howm
 (global-set-key "\C-c,," 'howm-menu)
 (setq howm-menu-lang 'ja)
 (setq howm-template "= <<< %title%cursor\n\n")
 (setq howm-menu-expiry-hours 2)
 (setq howm-menu-refresh-after-save nil)
 (add-to-list 'auto-mode-alist '("\\.howm$" . howm-mode)) )

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

;; Incremental Search on Minibuffer
(when (require 'minibuf-isearch nil t)
  (mapcar (lambda (keymap)
            (define-key keymap "\C-n" 'next-history-element)
            (define-key keymap "\C-p" 'previous-history-element))
          (list minibuffer-local-map minibuffer-local-ns-map minibuffer-local-completion-map)))

;; Anything
(setq anything-c-use-standard-keys t)
(when (require 'anything-config nil t)
  (global-set-key "\C-xb" 'anything)

  (setq anything-type-attributes
        '((file (action . (("Find File" . find-file)
                           ("Find File (Prompt)" .
                            (lambda (file)
                              (find-file (read-file-name "Find file: " file file))))
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
    (when (get-buffer-window anything-action-buffer 'visible)
      (anything-next-line)
      (exit-minibuffer))
    (anything-select-action))
  (define-key anything-map "\t" 'anything-select-action-or-execute-2nd-action)

  (setq anything-c-source-howm-recent-menu
    '((name . "howm")
      (candidates . (lambda ()
                      (mapcar (lambda (i)
                                (cons (nth 1 i) (car i)))
                              (howm-recent-menu 100))))
      (type . file)))

  (setq anything-sources
        `(anything-c-source-buffers
          anything-c-source-file-name-history
          anything-c-source-info-pages
          anything-c-source-man-pages
          anything-c-source-locate
          anything-c-source-emacs-commands
          ,(if (featurep 'howm-mode) anything-c-source-howm-recent-menu))) )


;; Perl
(setq auto-mode-alist
      (append '(("\\.p[lm]$" . cperl-mode)
                ("\\.t$" . cperl-mode)) auto-mode-alist))
(setq auto-mode-alist
      (cons '("\\.tt$" . html-mode) auto-mode-alist))
;; Perl Best Practices 2.11
(setq cperl-close-paren-offset -4
      cperl-continued-statement-offset 4
      cperl-indent-level 4
      cperl-indent-parens-as-block t
      cperl-tab-always-indent t)

(require-safety
 'set-perl5lib
 (add-hook 'cperl-mode-hook
           '(lambda ()
              (let ((path (concat (file-name-directory (buffer-file-name)) "lib")))
                (if (file-directory-p path)
                    (setenv "PERL5LIB" path)
                  (set-perl5lib)))
              (flymake-mode 1))))
(add-to-list 'flymake-allowed-file-name-masks '("\\.pm\\'" flymake-perl-init))

(when (require 'auto-complete nil t)
  (global-auto-complete-mode t))
