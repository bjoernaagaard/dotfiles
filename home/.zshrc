# Interactive zsh. The installer puts Prezto in ~/.zprezto and the tools below on PATH through mise.

# Completion files must be on fpath before Prezto runs compinit.
fpath=("$HOME/.local/share/zsh/site-functions" /opt/homebrew/share/zsh/site-functions $fpath)

if [[ -s "${ZDOTDIR:-$HOME}/.zprezto/init.zsh" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"
fi

# Prezto unsets this. The first Tab inserts the first match and opens the menu.
setopt MENU_COMPLETE

bindkey -e
HISTSIZE=50000
SAVEHIST=50000

# Up and Down search the history for lines that contain what you typed.
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down
[[ -n "$terminfo[kcuu1]" ]] && bindkey "$terminfo[kcuu1]" history-substring-search-up
[[ -n "$terminfo[kcud1]" ]] && bindkey "$terminfo[kcud1]" history-substring-search-down
# Ctrl+Left and Ctrl+Right move by word.
bindkey '^[[1;5C' forward-word
bindkey '^[[1;5D' backward-word

# Drop install folders inherited from an older shell before mise records PATH.
path=(${path:#$HOME/.local/share/mise/installs/*})
hash -r
eval "$(mise activate zsh)"
# fzf's key bindings need a terminal. Without one, zsh warns "can't change option: zle".
if [[ -t 0 ]]; then eval "$(fzf --zsh)"; fi
eval "$(zoxide init zsh --cmd cd)"
eval "$(starship init zsh)"

export FZF_DEFAULT_COMMAND="fd --type f --hidden --exclude .git"
export FZF_ALT_C_COMMAND="fd --type d --hidden --exclude .git"
export FZF_CTRL_T_COMMAND="fd --type f --hidden --exclude .git"
export FZF_CTRL_T_OPTS="--preview 'bat --color=always --style=numbers --line-range=:500 -- {}'"

alias ..='cd ..'
alias ...='cd ../..'
alias c='clear'
alias cat='bat'
alias la='eza --all --long --icons --git'
alias ll='eza --long --icons --git'
alias lt='eza --tree --level=2 --icons'
alias lc='eza --long --icons --git --changed --sort=changed'
alias lk='eza --long --icons --git --sort=size'
alias lm='eza --all --long --icons --git | less -R'
alias lr='eza --long --icons --git --recurse'
alias lu='eza --long --icons --git --accessed --sort=accessed'
alias refresh-completions='rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/prezto/zcompdump"{,.zwc} && autoload -Uz compinit && compinit -i -d "${XDG_CACHE_HOME:-$HOME/.cache}/prezto/zcompdump"'

# Report the folder to the terminal (OSC 7) on every cd, so new tabs and panes open in the same folder.
autoload -Uz add-zsh-hook
_report_pwd() { printf '\e]7;file://%s%s\e\\' "$HOST" "${PWD// /%20}" }
add-zsh-hook chpwd _report_pwd
_report_pwd

# pwd prints the folder and copies it to the clipboard. Over ssh, it copies through the terminal (OSC 52).
pwd() {
  emulate -L zsh
  if [[ ! -t 1 ]]; then
    builtin pwd "$@"
    return
  fi
  local current_directory encoded_directory
  current_directory="$(builtin pwd "$@" && print -n .)" || return
  current_directory="${current_directory%$'\n.'}"
  print -r -- "$current_directory"
  if [[ -z "$SSH_TTY$SSH_CONNECTION" ]] && (( $+commands[pbcopy] )); then
    print -rn -- "$current_directory" | pbcopy
  elif [[ -z "$SSH_TTY$SSH_CONNECTION" && -n "$WAYLAND_DISPLAY" ]] && (( $+commands[wl-copy] )); then
    print -rn -- "$current_directory" | wl-copy
  elif [[ -z "$SSH_TTY$SSH_CONNECTION" && -n "$DISPLAY" ]] && (( $+commands[xclip] )); then
    print -rn -- "$current_directory" | xclip -selection clipboard
  else
    encoded_directory="$(print -rn -- "$current_directory" | base64 | tr -d '\r\n')" || return
    printf '\033]52;c;%s\007' "$encoded_directory"
  fi
}

# Settings for this computer only. The installer never overwrites this file.
[[ -r "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"
