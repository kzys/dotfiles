#! sh
debug=0
t0=$(date +%s%N)

milestone() {
    if [[ "$debug" -ne 1 ]]; then
	return
    fi

    t1=$(date +%s%N)
    printf "%8s %4sms\n" "$1" $(echo "scale=2; ($t1 - $t0)/1000000" | bc)
    t0=$t1
}

if test ! -d ~/.zsh; then
  mkdir ~/.zsh
fi

# Go
# https://go.dev/doc/manage-install#installing-multiple installs Go under ~/sdk.
# Pick the latest from the directory.
go_sdk=$(ls -r ~/sdk | sort | tail -1)

# Path
# http://www.clear-code.com/blog/2011/9/5.html
typeset -U path
path=(
    ~/ws/dotfiles/bin(N)
    ~/local/bin(N)
    ~/bin(N)

    ~/Library/Python/2.7/bin(N)

    ~/sdk/$go_sdk/bin(N)

    # rustup installs rust and cargo under the directory
    ~/.cargo/bin(N)

    # https://fly.io/docs/flyctl/
    ~/.fly/bin(N)

    ~/ws/node-v18.15.0-linux-x64/bin(N)

    # "pip install --user" uses ~/.local/
    ~/.local/bin(N)
    
    $path
)

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

# Private
dotfiles_private=$HOME/src/dotfiles-private
if [ -e $dotfiles_private/zshrc ]; then
    . $dotfiles_private/zshrc
    PATH=$dotfiles_private/bin:$PATH
fi

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
export LANG=en_US.UTF-8
export LC_MESSAGES=$LANG
export LC_ALL=$LANG

export WWW_HOME=http://www.google.co.jp/
export CVS_RSH=ssh

export FTP_PASSIVE=1
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/usr/lib/pkgconfig
# export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/sw/lib/freetype219/lib/pkgconfig:/sw/lib/pkgconfig:/usr/lib/pkgconfig

## Java
# Don't use JAVA_TOOL_OPTIONS because of annoying
# "Picked up JAVA_TOOL_OPTIONS: ..." message...
export ANT_OPTS='-Dfile.encoding=UTF8 -Xmx2G -XX:MaxPermSize=1G'

export EDITOR=vi
bindkey -e

if [ ! -z "$TMUX" ]; then
    set-title() {
      echo -ne "\e]2;$1\e\\"
    }
else
  set-title() {
      echo -ne "\e]2;$1\007"
  }
fi

preexec () {
  set-title "$1"
}

autoload -U vcs_info
zstyle ':vcs_info:*' enable git svn
zstyle ':vcs_info:git:*' formats '%b %m%u%c'

# see zshmisc to know %(? ... ) and other expressions
precmd () {
    # python
    local prompt_virtual_env=''
    if [ -e "$VIRTUAL_ENV" ]; then
        prompt_virtual_env=" virtualenv:$(basename "$VIRTUAL_ENV")"
    fi

    PROMPT="%{%(?.$fg[green].$fg[red])%}%~ @ $(hostname)$prompt_virtual_env$reset_color
%# "

    # show git's status
    vcs_info
    RPROMPT="$vcs_info_msg_0_"

    # tmux
    set-title "$(print -n -P '%~')"
}

REPORTTIME=5

if test -n $SSH_AGENT_PID; then
  (ssh-add -L | grep kato.kazuyoshi@gmail.com > /dev/null) || ssh-add ~/secrets/id_ed25519
fi

# Android
if [ -d $HOME/Library/Android/sdk ]; then
    ANDROID_HOME=$HOME/Library/Android/sdk
elif [ -d $HOME/src/adt-bundle-linux-x86_64-20140702 ]; then
    ANDROID_HOME=$HOME/src/adt-bundle-linux-x86_64-20140702/sdk
elif [ -d $HOME/src/adt-bundle-mac-x86_64-20140702 ]; then
    ANDROID_HOME=$HOME/src/adt-bundle-mac-x86_64-20140702/sdk
fi

if [ ! -z "$ANDROID_HOME" ]; then
    export ANDROID_HOME

    PATH=$ANDROID_HOME/tools:$PATH              # android, emulator, ...
    PATH=$ANDROID_HOME/platform-tools:$PATH     # adb, fastboot, ...

    # aapt, aidl, ...
    for build_tool_path in $ANDROID_HOME/build-tools/*
    do
        PATH=$build_tool_path:$PATH
    done
fi

# Android NDK
PATH=$HOME/src/android-ndk-r10e:$PATH

# Python
export LC_ALL=$LANG

# rbenv
# https://github.com/sstephenson/rbenv#installation
# https://github.com/sstephenson/ruby-build#installing-as-an-rbenv-plugin-recommended
if [ -d $HOME/.rbenv ]; then
    export PATH="$HOME/.rbenv/bin:$PATH"
    eval "$(rbenv init -)"
fi

# Rust
if [ -d $HOME/local/lib/rustlib/x86_64-apple-darwin/lib ]; then
    export DYLD_LIBRARY_PATH=$HOME/local/lib/rustlib/x86_64-apple-darwin/lib
fi

cdw_dirs=(
    ~/ws(N)
    ~/ec2-ws(N)
    ~/go/src(N)
)

# the variable must be declared first
# http://mywiki.wooledge.org/BashPitfalls#local_varname.3D.24.28command.29
function cdw {
    local dir
    dir="$(find $cdw_dirs -maxdepth 3 -type d -not -name '.*' | fzy)"
    if [ $? -eq 0 ]; then
       cd "$dir"
    fi
}

if [ -f ~/.zsh/init-work.sh ]; then
    . ~/.zsh/init-work.sh
fi

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/home/kazuyoshi/ws/google-cloud-sdk/path.zsh.inc' ]; then . '/home/kazuyoshi/ws/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/home/kazuyoshi/ws/google-cloud-sdk/completion.zsh.inc' ]; then . '/home/kazuyoshi/ws/google-cloud-sdk/completion.zsh.inc'; fi

milestone end
