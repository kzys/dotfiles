# Fink
if test -f /sw/bin/init.sh; then
    source /sw/bin/init.sh
fi

# Path
export PATH=$HOME/bin:/usr/local/bin:$PATH
fpath=(~/.zsh/functions $fpath)

# Alias
if ls -wF >& /dev/null; then
    alias ls='ls -wF'
else
    alias ls='ls -F'
fi

if which emacs-nox >& /dev/null; then
    alias emacs='emacs-nox'
fi

# History
HISTFILE=~/.zsh/history
HISTSIZE=10000
SAVEHIST=$HISTSIZE
setopt extended_history hist_ignore_dups

# Completion
autoload -U compinit
compinit

# Prompt
PROMPT='%# '
RPROMPT='%~ '

# Misc
setopt extended_glob

# ENV
export LANG=C
export LC_CTYPE=ja_JP.UTF-8

export WWW_HOME=http://www.google.co.jp/
export CVS_RSH=ssh
export RUBYLIB=/usr/local/lib/ruby/site_ruby/1.8/
export PERL5LIB=$HOME/CPAN/lib/perl5/site_perl/:$PERL5LIB
export FTP_PASSIVE=1
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/sw/lib/freetype219/lib/pkgconfig:/sw/lib/pkgconfig:/usr/lib/pkgconfig

export EDITOR=vi
bindkey -e

if test $TERM = screen; then
    set-title() {
      echo -ne "\ek$1\e\\"
    }
else
  set-title() {}
fi

preexec () {
  set-title $1
}
precmd () {
  set-title $(print -n -P '%~')
}
