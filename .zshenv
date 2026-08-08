# ~/.zshenv — runs for EVERY shell (interactive + non-interactive)
#
# Cache and evaluation
# --------------------
# The function _zsh_cache_eval caches the output of static eval commands,
# for example: eval "$(brew shellenv)". The function sources the cached
# file instead of running the command. Shell startup remains fast and the
# tool maintains its behavior.
# - Refresh the cache every 24 hours. Refresh also when the cache file is
#   missing.
# - Set ZSH_FORCE_REFRESH=1 to force a refresh. The background refresher
#   uses this variable.
# - Compile the cache with zcompile after generation. The source command
#   loads the compiled file (.zwc) when it is newer. A compiled file
#   loads faster.
# - An old cache file is still useful. When the cache is old, do not
#   remove the file. Refresh it in the background. The next shell uses
#   the new file. Only one refresher runs at a time. The lock file is
#   .refreshing. A lock older than 10 minutes comes from a stopped
#   refresher; replace it.
# - Glob qualifiers need EXTENDED_GLOB. Do not use localoptions: it would
#   undo option changes made by sourced files, for example starship's
#   setopt promptsubst. Save and restore EXTENDED_GLOB manually so that
#   option changes from sourced files remain.
#
# PATH order
# ----------
# ~/.local/bin remains ahead of mise shims. Wrappers such as
# age-plugin-yubikey (locale guard) must win over the mise symlink.
# These directories are available to interactive and non-interactive
# shells: mise shims, grok CLI, dory CLI (docker shims and Dory helpers),
# and bb CLI. The bb CLI is part of the bb.app desktop application. The
# guard does not change PATH when the application is absent.
#
# Environment
# -----------
# - Locale guard: age-plugin-yubikey panics without LANG/LC_ALL.
# - SSH agent: the Bitwarden desktop agent serves keys from the vault,
#   not from disk.
# - FNOX and Homebrew environment variables.
# - Source ~/.zshenv.private when it exists.

_zsh_cache_eval() {
  local _had_extendedglob=0
  [[ -o EXTENDED_GLOB ]] && _had_extendedglob=1
  setopt extendedglob
  local name="$1" watch=""
  shift
  if [[ "$1" == --watch ]]; then
    watch="$2"
    shift 2
  fi
  local cmd="$1"
  shift
  local dir="$XDG_CACHE_HOME/zsh/eval"
  local cache="$dir/$name"
  local tmp="$cache.tmp.$$"
  [[ -d "$dir" ]] || mkdir -p "$dir"
  local refresh=0
  if [[ ! -f "$cache" ]] || [[ -n "$ZSH_FORCE_REFRESH" ]]; then
    refresh=1
  elif [[ -n "$cache"(#qN.mh+24) ]] \
       || [[ -n "$watch" && "$watch" -nt "$cache" ]]; then
    refresh=2
  fi
  if [[ $refresh -eq 2 ]]; then
    local lock="$dir/.refreshing"
    if mkdir "$lock" 2>/dev/null || [[ -n "$lock"(#qN.mh+10) ]]; then
      ( ZSH_FORCE_REFRESH=1 zsh -i -c exit >/dev/null 2>&1; rmdir "$lock" 2>/dev/null ) &!
    fi
  elif [[ $refresh -eq 1 ]]; then
    if command -v "$cmd" >/dev/null 2>&1 && "$cmd" "$@" >| "$tmp" 2>/dev/null; then
      mv -f "$tmp" "$cache"
      zcompile "$cache" 2>/dev/null
      rm -f "$tmp"
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

_zsh_cache_eval mise ~/.local/bin/mise activate zsh --shims

export PATH="$HOME/.local/bin:$PATH"

export PATH="$HOME/.grok/bin:$PATH"

export PATH="$HOME/.dory/bin:$PATH"

BB_CLI_BIN="/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist"
if [[ -x "$BB_CLI_BIN/bb" ]]; then
  case ":$PATH:" in
    *":$BB_CLI_BIN:"*) ;;
    *) export PATH="$BB_CLI_BIN:$PATH" ;;
  esac
fi

export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

export SSH_AUTH_SOCK="$HOME/.bitwarden-ssh-agent.sock"

export FNOX_PROFILE="default"
export FNOX_SHELL_OUTPUT=none
export FNOX_AGE_KEY_FILE="$HOME/.local/state/fnox/yubikey.identity"
export UV_VENV_CLEAR=1
export HOMEBREW_NO_ENV_HINTS=1
export HOMEBREW_NO_INSTALL_CLEANUP=0

[ -f "$HOME/.zshenv.private" ] && source "$HOME/.zshenv.private"