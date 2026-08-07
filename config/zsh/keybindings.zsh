# ~/.config/zsh/keybindings.zsh — interactive keybindings

# zsh-history-substring-search
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

# zsh 5.9's line editor mangles modified cursor-key sequences:
# Shift+Arrow sends ^[[1;2X, Ctrl+Arrow sends ^[[1;5X - zle eats the
# leading ESC[1 and types the tail (e.g. ";2D") as literal text.
# Binding the full sequences makes zle recognize them.
bindkey '^[[1;2A' history-substring-search-up
bindkey '^[[1;2B' history-substring-search-down
bindkey '^[[1;2C' forward-char
bindkey '^[[1;2D' backward-char
bindkey '^[[1;2H' beginning-of-line
bindkey '^[[1;2F' end-of-line
bindkey '^[[1;5A' history-substring-search-up
bindkey '^[[1;5B' history-substring-search-down
bindkey '^[[1;5C' forward-word
bindkey '^[[1;5D' backward-word
bindkey '^[[1;5H' beginning-of-line
bindkey '^[[1;5F' end-of-line
