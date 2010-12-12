(require 'sgml-match-mode)
(add-hook 'sgml-mode-hook
          '(lambda ()
             (sgml-match-mode t)))
