(require 'flymake)

(mapcar
 (lambda (face)
   (set-face-background face nil)
   (set-face-foreground face "red")
   (set-face-underline face t))
 (list 'flymake-errline 'flymake-warnline))


(defun flymake-display-err-on-minibuffer ()
  "Displays the error/warning for the current line in the minibuffer"
  (interactive)
  (let* ((line-no             (flymake-current-line-no))
         (line-err-info-list  (nth 0 (flymake-find-err-info flymake-err-info line-no)))
         (count               (length line-err-info-list))
         (messages))
    (while (> count 0)
      (let* ((info (nth (1- count) line-err-info-list))
             (file (flymake-ler-file info))
             (text (flymake-ler-text info))
             (line (flymake-ler-line info))
             (full-file (flymake-ler-full-file info)))
        (setq messages (cons (format "%d: %s" line text) messages)))
      (setq count (1- count)))
    (if (> (length messages) 0)
        (message "%s"
                 (mapconcat 'identity messages "\n")))))

(run-with-idle-timer 1 t 'flymake-display-err-on-minibuffer)
