#! sh

# Fink
#if test -f /sw/bin/init.sh; then
#    source /sw/bin/init.sh
#fi

if test ! -d ~/.zsh; then
  mkdir ~/.zsh
fi

# Path
PATH=$HOME/bin:$PATH

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
setopt transient_rprompt

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

if test -f $HOME/perl5/perlbrew/etc/bashrc; then
    source $HOME/perl5/perlbrew/etc/bashrc
elif test -e $HOME/local/lib/perl5; then
    eval $(perl -I$HOME/local/lib/perl5 -Mlocal::lib)
fi

PYTHONPATH="$HOME/local/lib/python:$HOME/local/lib/python2.6"
export PYTHONPATH

## Ruby
if test -d .rbenv; then
    PATH=$HOME/.rbenv/bin:$PATH
    export PATH="${HOME}/.rbenv/shims:${PATH}"
    source "/home/kzys/.rbenv/libexec/../completions/rbenv.zsh"
    rbenv rehash 2>/dev/null
fi

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

autoload -U vcs_info
zstyle ':vcs_info:*' enable git svn
zstyle ':vcs_info:git:*' check-for-changes true
zstyle ':vcs_info:git:*' formats '%b %m%u%c'

original_prompt="%~ @ $(hostname)"
precmd () {
  PROMPT="%{%(?.$fg[green].$fg[red])%}$original_prompt$reset_color
%# "

  vcs_info
  RPROMPT="$vcs_info_msg_0_"

  set-title "$(print -n -P '%~') @ $(hostname)"
}

REPORTTIME=5

if test -n $SSH_AGENT_PID; then
  (ssh-add -L >& /dev/null) || ssh-add
fi
