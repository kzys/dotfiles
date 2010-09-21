;; Buffer
(require 'uniquify)
(setq uniquify-buffer-name-style 'post-forward-angle-brackets)

;; Incremental Search on Minibuffer
(require-safety
 'minibuf-isearch
 (mapcar (lambda (keymap)
           (define-key keymap "\C-n" 'next-history-element)
           (define-key keymap "\C-p" 'previous-history-element))
         (list minibuffer-local-map
               minibuffer-local-ns-map
               minibuffer-local-completion-map)))

(setq minibuf-isearch-use-migemo nil)
