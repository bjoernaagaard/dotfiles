# ~/.config/zsh/completions.zsh — compinit and Carapace

autoload -Uz compinit
local zcompdump="$XDG_CACHE_HOME/zsh/zcompdump-carapace"
mkdir -p "${zcompdump:h}"
if [[ ! -f "$zcompdump" ]] || [[ -n "$zcompdump"(#qN.mh+24) ]]; then
  compinit -d "$zcompdump"
else
  compinit -C -d "$zcompdump"
fi

# Carapace provides the completion registry and bridges other shell formats.
export CARAPACE_BRIDGES="${CARAPACE_BRIDGES:-zsh,fish,bash,inshellisense}"
_zsh_cache_eval carapace carapace _carapace zsh

# Load the remaining interactive plugins after compinit.
_zsh_cache_eval sheldon-postcompinit-clean sheldon --profile post-compinit source
