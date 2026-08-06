# ~/.zshenv — runs for EVERY shell (interactive + non-interactive)

# Cache the output of static `eval "$(cmd ...)"` invocations and source the
# cached file. Refresh every 24 hours or when the cache is missing so shell
# startup stays fast without losing the tool's behaviour.
_zsh_cache_eval() {
  # Glob qualifiers need EXTENDED_GLOB, but `localoptions` would undo option
  # changes made by the files we source (e.g., starship's `setopt promptsubst`).
  # Save/restore only EXTENDED_GLOB manually so sourced side-effects persist.
  local _had_extendedglob=0
  [[ -o EXTENDED_GLOB ]] && _had_extendedglob=1
  setopt extendedglob
  local name="$1" cmd="$2"
  shift 2
  local dir="$XDG_CACHE_HOME/zsh/eval"
  local cache="$dir/$name"
  local tmp="$cache.tmp.$$"
  mkdir -p "$dir"
  if [[ ! -f "$cache" ]] || [[ -n "$cache"(#qN.mh+24) ]] \
     || [[ "$XDG_CONFIG_HOME/sheldon/plugins.toml" -nt "$cache" ]]; then
    if command -v "$cmd" >/dev/null 2>&1 && "$cmd" "$@" >| "$tmp" 2>/dev/null; then
      mv -f "$tmp" "$cache"
    else
      rm -f "$tmp"
    fi
  fi
  [[ -f "$cache" ]] && source "$cache"
  [[ $_had_extendedglob -eq 0 ]] && unsetopt extendedglob
}


export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

_zsh_cache_eval brew /opt/homebrew/bin/brew shellenv
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.cache/.bun/bin:$PATH"

# mise shims (available to interactive and non-interactive shells)
_zsh_cache_eval mise ~/.local/bin/mise activate zsh --shims

# grok CLI (available to interactive and non-interactive shells)
export PATH="$HOME/.grok/bin:$PATH"

export FNOX_PROFILE="default"
export FNOX_SHELL_OUTPUT=none
export FNOX_AGE_KEY_FILE="$HOME/.local/state/fnox/yubikey-yk-usb-a.identity"
export UV_VENV_CLEAR=1
export HOMEBREW_NO_ENV_HINTS=1
export HOMEBREW_NO_INSTALL_CLEANUP=0
