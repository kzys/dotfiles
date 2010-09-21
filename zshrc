# Fink
#if test -f /sw/bin/init.sh; then
#    source /sw/bin/init.sh
#fi

if test ! -d ~/.zsh; then
  mkdir ~/.zsh
fi

# Path
# export PATH=$HOME/bin:/usr/local/bin:$PATH
export PATH=$HOME/bin:$HOME/local/bin:$HOME/src/scala-2.7.4.final/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin
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
setopt extended_history hist_ignore_dups share_history

# Completion
autoload -U compinit
compinit -d ~/.zsh/compdump

# Prompt
autoload -U colors
colors
PROMPT="$fg[green]%~ @ `hostname`$reset_color
%# "
# RPROMPT="%~ "

# Misc
setopt extended_glob print_eight_bit noflow_control
# unsetopt prompt_cr
WORDCHARS='*?_-.[]~=&;!#$%^(){}<>:'

# ENV
export LANG=ja_JP.UTF-8
export LC_MESSAGES=C

export PAGER=less
export WWW_HOME=http://www.google.co.jp/
export CVS_RSH=ssh
export RUBYLIB=/usr/local/lib/ruby/site_ruby/1.8

eval $(perl -I$HOME/local/lib/perl5 -Mlocal::lib)

PYTHONPATH="$HOME/local/lib/python:$HOME/local/lib/python2.6"
export PYTHONPATH

export FTP_PASSIVE=1
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/usr/lib/pkgconfig
# export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/sw/lib/freetype219/lib/pkgconfig:/sw/lib/pkgconfig:/usr/lib/pkgconfig

export EDITOR=vi
bindkey -e

if test x$WINDOW != x; then
    set-title() {
      screen -X eval "title '$1'"
    }
else
  set-title() {
      echo -ne "\e]2;$1\007"
  }
fi

preexec () {
  set-title "$1 @ $(hostname)"
}

original_prompt="%~ @ $(hostname)"
precmd () {
  PROMPT="%{%(?.$fg[green].$fg[red])%}$original_prompt$reset_color
%# "
  set-title "$(print -n -P '%~') @ $(hostname)"
}
