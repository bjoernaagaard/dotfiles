# ~/.config/zsh/aliases.zsh — shell aliases

alias ci='code-insiders'

alias c='clear'
alias h='history'
alias cp='cp -i'
alias mv='mv -i'
alias df='df -h'
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'

if command -v eza >/dev/null 2>&1; then
  alias ls='eza -a -1 --icons --group-directories-first'
  alias l='eza -1 --icons --group-directories-first'
  alias la='eza -a -1 --icons --group-directories-first'
  alias ll='eza -l --icons --group-directories-first --no-user --no-group --no-permissions --no-filesize --time=modified --time-style="%Y-%m-%d %H:%M" --git'
  alias lt='eza -T --level=2 --icons --group-directories-first'
  alias tree='eza --tree --icons --group-directories-first'
fi

if command -v bat >/dev/null 2>&1; then
  alias cat='bat --paging=never'
fi
