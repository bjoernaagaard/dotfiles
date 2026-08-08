# ~/.config/zsh/completions.zsh — compinit and Carapace

autoload -Uz compinit
local zcompdump="$XDG_CACHE_HOME/zsh/zcompdump-carapace"
mkdir -p "${zcompdump:h}"
if [[ ! -f "$zcompdump" ]] || [[ -n "$zcompdump"(#qN.mh+24) ]]; then
  compinit -d "$zcompdump"
else
  compinit -C -d "$zcompdump"
fi

# CLI-generated completions (cached like other shell integrations; each
# script self-registers via compdef when sourced after compinit).
_zsh_cache_eval gh gh completion -s zsh
_zsh_cache_eval glab glab completion -s zsh
_zsh_cache_eval bun bun completions zsh
_zsh_cache_eval pnpm pnpm completion zsh
_zsh_cache_eval starship-completions starship completions zsh
_zsh_cache_eval ruff ruff generate-shell-completion zsh
_zsh_cache_eval rustup rustup completions zsh
_zsh_cache_eval lazygit lazygit completion zsh
_zsh_cache_eval yq yq shell-completion zsh
_zsh_cache_eval ast-grep ast-grep completions zsh
_zsh_cache_eval uv uv generate-shell-completion zsh
_zsh_cache_eval docker docker completion zsh

# Load the remaining interactive plugins after compinit.
_zsh_cache_eval sheldon-postcompinit-clean sheldon --profile post-compinit source
