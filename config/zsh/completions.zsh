# ~/.config/zsh/completions.zsh — compinit and completions

autoload -Uz compinit
local zcompdump="$XDG_CACHE_HOME/zsh/zcompdump-carapace"
mkdir -p "${zcompdump:h}"
if [[ ! -f "$zcompdump" ]] || [[ -n "$zcompdump"(#qN.mh+24) ]]; then
  compinit -d "$zcompdump"
else
  compinit -C -d "$zcompdump"
fi

# ── Self-generating completions ──────────────────────
# Each tool outputs a compdef script on stdout. _zsh_cache_eval caches the
# output (24h) and sources it after compinit so compdef registers the function.
# Cache keys must be unique — a collision between tools.zsh ("fnox" for
# activate) and here ("fnox" for completion) caused the completion to never
# be generated because tools.zsh wins the race and writes the activate script
# first. The key below is "fnox-completions" to avoid that collision.

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

# ── Static completion files ──────────────────────────
# These 3 files ship in mise installs with no `completion` subcommand. They
# have an explicit compdef guard at the bottom, so sourcing them registers
# the function immediately — no fpath needed.
#
#   _sheldon   ← sheldon/<ver>/completions/sheldon.zsh
#   _ya        ← yazi/<ver>/completions/_ya
#   _yazi      ← yazi/<ver>/completions/_yazi

[[ -f ~/.config/zsh/completions/_sheldon ]] && source ~/.config/zsh/completions/_sheldon
[[ -f ~/.config/zsh/completions/_ya ]] && source ~/.config/zsh/completions/_ya
[[ -f ~/.config/zsh/completions/_yazi ]] && source ~/.config/zsh/completions/_yazi

# _bat, _fastfetch, _fd, and _rg also lack a `completion` subcommand, but
# their files use the old-style #compdef tag (no explicit compdef guard) and
# auto-execute at the bottom when sourced. They rely on compinit discovering
# them via fpath (plugins.zsh adds ~/.config/zsh/completions to fpath). The
# compinit dump includes them — no extra config needed.
#
#   _bat       ← bat/<ver>/.../autocomplete/bat.zsh
#   _fastfetch ← fastfetch/<ver>/.../share/zsh/site-functions/_fastfetch
#   _fd        ← fd/<ver>/.../autocomplete/_fd
#   _rg        ← rg/<ver>/.../complete/_rg

# ── Sheldon post-compinit plugins ────────────────────
_zsh_cache_eval sheldon-postcompinit-clean sheldon --profile post-compinit source
