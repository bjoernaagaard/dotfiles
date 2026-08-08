# =============================================================================
# completions.zsh — completion setup
# =============================================================================
#
# Build the dump again when a completion source changed. An old dump
# prevents new completions from being loaded for up to 24 h. The variable
# ZSH_FORCE_REFRESH=1 forces a rebuild. The background refresher uses it.
#
# zoxide init runs in tools.zsh before compinit. Therefore, zoxide's
# completion is not registered. Register z after compinit.
#
# Generated completions: each tool prints a completion script.
# _zsh_cache_eval caches the script for 24 h and sources it after
# compinit. Cache keys must be unique. The key fnox-completions does not
# conflict with the fnox key in tools.zsh.
#
# bw's script does not register the completion. Register _bw explicitly.
#
# Static completion files: _sheldon, _ya, and _yazi register themselves
# when loaded. _bat, _fd, _rg, _fastfetch, _eza, and _localterm load from
# fpath through compinit. No extra configuration is needed.
#
# Plugin compilation
# ------------------
# The background refresh (ZSH_FORCE_REFRESH=1) compiles the sourced
# plugin files again. The source command then loads their compiled
# variants (.zwc). zsh ignores a compiled variant that is out of date.
# A plugin update falls back to the plain file until the next refresh.

autoload -Uz compinit
local zcompdump="$XDG_CACHE_HOME/zsh/zcompdump-carapace"
mkdir -p "${zcompdump:h}"
if [[ ! -f "$zcompdump" ]] || [[ -n "$ZSH_FORCE_REFRESH" ]] \
   || [[ -n "$zcompdump"(#qN.mh+24) ]] \
   || [[ ~/.config/zsh/completions -nt "$zcompdump" ]] \
   || [[ /opt/homebrew/share/zsh/site-functions -nt "$zcompdump" ]]; then
  compinit -d "$zcompdump"
else
  compinit -C -d "$zcompdump"
fi

(( ${+functions[__zoxide_z_complete]} )) && compdef __zoxide_z_complete z

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
_zsh_cache_eval mise-completions mise completion zsh
_zsh_cache_eval delta delta --generate-completion zsh
_zsh_cache_eval rclone rclone completion zsh -
_zsh_cache_eval glow glow completion zsh
_zsh_cache_eval tailscale tailscale completion zsh
_zsh_cache_eval fnox-completions fnox completion zsh
_zsh_cache_eval bw bw completion --shell zsh
(( ${+functions[_bw]} )) && compdef _bw bw
_zsh_cache_eval reasonix reasonix completion zsh

[[ -f ~/.config/zsh/completions/_sheldon ]] && source ~/.config/zsh/completions/_sheldon
[[ -f ~/.config/zsh/completions/_ya ]] && source ~/.config/zsh/completions/_ya
[[ -f ~/.config/zsh/completions/_yazi ]] && source ~/.config/zsh/completions/_yazi

_zsh_cache_eval sheldon-postcompinit-clean --watch "$XDG_CONFIG_HOME/sheldon/plugins.toml" sheldon --profile post-compinit source

if [[ -n "$ZSH_FORCE_REFRESH" ]]; then
  for _f in ~/.local/share/sheldon/repos/github.com/*/*/*.zsh(N); do
    [[ -f "$_f.zwc" && "$_f.zwc" -nt "$_f" ]] || zcompile "$_f" 2>/dev/null
  done
  unset _f
fi