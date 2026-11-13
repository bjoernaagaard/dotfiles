# Prints the lines of an old zsh startup file that still make sense with the new config.
#
# Usage: awk -f carry-over.awk new-file old-file
#
# It drops lines that set up another framework or prompt (Oh My Zsh, Prezto, Powerlevel10k,
# zinit, antigen, and others), lines that the new config already runs, and lines that are
# exact copies of a line in the new file. An `if` block that spans several lines is kept or
# dropped as a whole, so the output stays valid zsh. Comment lines are dropped, except the
# markers that tools like conda use to find their own block.

BEGIN {
  drop = "oh-my-zsh|ZSH_THEME|^[[:space:]]*(export[[:space:]]+)?ZSH(_CUSTOM|_CACHE_DIR)?=|^[[:space:]]*plugins=" \
    "|zprezto|p10k|powerlevel|instant-prompt|zinit|antigen|zplug|antidote|znap|zgen|spaceship" \
    "|starship init|mise activate|zoxide init|fzf --zsh|\\.fzf\\.zsh|compinit|promptinit" \
    "|^[[:space:]]*prompt[[:space:]]|^[[:space:]]*(export[[:space:]]+)?(PROMPT|PS1|RPROMPT|RPS1)=" \
    "|zsh-autosuggestions|zsh-syntax-highlighting|history-substring-search|skip_global_compinit" \
    "|^[[:space:]]*bindkey[[:space:]]+-[ev][[:space:]]*$|^[[:space:]]*(HISTSIZE|SAVEHIST)=" \
    "|^[[:space:]]*(export[[:space:]]+)?(DISABLE_[A-Z_]+|ENABLE_CORRECTION|COMPLETION_WAITING_DOTS|HIST_STAMPS|CASE_SENSITIVE|HYPHEN_INSENSITIVE|UPDATE_ZSH_DAYS)=" \
    "|zstyle[[:space:]]+.:omz|ZDOTDIR="
  opens_if = "^[[:space:]]*if[[:space:]]"
  closes_if = "(^|[;[:space:]])fi([;[:space:]]|$)"
}

# The first file is the new config. Remember its settings so exact copies are dropped.
# Lines like "}" or "fi" stay, because the old file needs them to close its own blocks.
FNR == NR {
  if ($0 ~ /^[[:space:]]*(alias|export|eval|bindkey|setopt|unsetopt|source|typeset|autoload|add-zsh-hook|zstyle|path=|fpath=|\[\[)[[:space:]=(]/) ours[$0] = 1
  next
}

# Inside an Oh My Zsh style plugins=( ... ) list that spans several lines.
in_list {
  if ($0 ~ /\)/) in_list = 0
  next
}

# Inside a multi-line if block. Collect it, and keep it only if no line matches the drop list.
depth > 0 {
  block = block $0 "\n"
  if ($0 ~ drop) bad = 1
  if ($0 ~ opens_if && $0 !~ closes_if) depth++
  else if ($0 ~ /^[[:space:]]*fi([;[:space:]]|$)/) depth--
  if (depth == 0) {
    if (!bad) { printf "%s", block; blank = 0 }
    block = ""
    bad = 0
  }
  next
}

/^[[:space:]]*plugins=\(/ && !/\)/ { in_list = 1; next }

$0 ~ opens_if && $0 !~ closes_if {
  depth = 1
  block = $0 "\n"
  bad = ($0 ~ drop)
  next
}

$0 ~ drop { next }
/^[[:space:]]*#/ && !/>>>|<<</ { next }
$0 in ours { next }

# Print at most one blank line in a row, and none at the start.
/^[[:space:]]*$/ {
  if (printed && !blank) print ""
  blank = 1
  next
}

{ print; printed = 1; blank = 0 }

# An if block with no closing fi was already broken in the old file. Keep it so nothing is lost.
END { if (block != "") printf "%s", block }
