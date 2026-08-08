# =============================================================================
# keybindings.zsh — interactive keybindings
# =============================================================================
#
# The up/down arrow keys use the zsh-history-substring-search widget.
# zsh-shift-select owns Shift-modified movement keys.
#
# zsh 5.9 removes the ESC[1 prefix of modified cursor keys. Because of this,
# bind the full sequences so that zle recognizes them.

bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

bindkey '^[[1;5A' history-substring-search-up
bindkey '^[[1;5B' history-substring-search-down
bindkey '^[[1;5C' forward-word
bindkey '^[[1;5D' backward-word
bindkey '^[[1;5H' beginning-of-line
bindkey '^[[1;5F' end-of-line
