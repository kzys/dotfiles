(require 'flymake)

(mapcar
 (lambda (face)
   (set-face-background face nil)
   (set-face-foreground face "red")
   (set-face-underline face t))
 (list 'flymake-errline 'flymake-warnline))


(defun flymake-display-error-on-minibuffer ()
  "Displays the error/warning for the current line in the minibuffer"
  (interactive)
  (let* ((line-no             (flymake-current-line-no))
         (line-err-info-list  (nth 0 (flymake-find-err-info flymake-err-info line-no)))
         (count               (length line-err-info-list)))
    (while (> count 0)
      (when line-err-info-list
        (let* ((file       (flymake-ler-file (nth (1- count) line-err-info-list)))
               (full-file  (flymake-ler-full-file (nth (1- count) line-err-info-list)))
               (text (flymake-ler-text (nth (1- count) line-err-info-list)))
               (line       (flymake-ler-line (nth (1- count) line-err-info-list))))
          (message "[%s] %s" line text)))
      (setq count (1- count)))))

(run-with-idle-timer 1 t 'flymake-display-error-on-minibuffer)
