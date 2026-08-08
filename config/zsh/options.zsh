# =============================================================================
# options.zsh — history and shell options
# =============================================================================
#
# This file contains the history options and the shell behaviour options.

HISTFILE="${XDG_STATE_HOME:-$HOME/.local/state}/zsh/history"
HISTSIZE=100000
SAVEHIST=100000

[[ -d "${HISTFILE%/*}" ]] || mkdir -p "${HISTFILE%/*}"

setopt EXTENDED_HISTORY
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt HIST_REDUCE_BLANKS
setopt HIST_SAVE_NO_DUPS
setopt HIST_FIND_NO_DUPS
setopt HIST_EXPIRE_DUPS_FIRST
setopt HIST_FCNTL_LOCK
setopt SHARE_HISTORY

setopt AUTOCD
setopt AUTO_PUSHD
setopt PUSHD_IGNORE_DUPS
setopt PUSHD_SILENT
setopt NUMERIC_GLOB_SORT
setopt INTERACTIVE_COMMENTS
setopt EXTENDED_GLOB
setopt NOBEEP
setopt LONG_LIST_JOBS
setopt PIPE_FAIL
