# =============================================================================
# keybindings.zsh — interactive keybindings
# =============================================================================
#
# The up/down arrow keys use the zsh-history-substring-search widget.
#
# zsh 5.9 removes the ESC[1 prefix of modified cursor keys. Because of this,
# bind the full sequences so that zle recognizes them.

bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

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
