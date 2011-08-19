
(mapcar
 (lambda (face)
   (set-face-background face nil)
   (set-face-foreground face "red")
   (set-face-underline face t))
 (list 'flymake-errline 'flymake-warnline))
