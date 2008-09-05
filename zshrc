# Fink
#if test -f /sw/bin/init.sh; then
#    source /sw/bin/init.sh
#fi

if test ! -d ~/.zsh; then
  mkdir ~/.zsh
fi

# Path
# export PATH=$HOME/bin:/usr/local/bin:$PATH
export PATH=$HOME/local/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin
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
compinit

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

PERL5LIB=''
for i in $HOME/local/lib*/**/site_perl
do
  PERL5LIB="$i:$PERL5LIB"
done
export PERL5LIB

PYTHONPATH=''
for i in $HOME/local/lib*/python*/site-packages
do
    PYTHONPATH="$i:$PYTHONPATH"
done
export PYTHONPATH

export FTP_PASSIVE=1
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/usr/lib/pkgconfig
# export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/sw/lib/freetype219/lib/pkgconfig:/sw/lib/pkgconfig:/usr/lib/pkgconfig

export EDITOR=vi
bindkey -e

if test $TERM = screen; then
    set-title() {
      echo -ne "\ek$1\e\\"
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
