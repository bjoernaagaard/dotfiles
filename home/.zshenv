# Environment for every zsh, including non-interactive commands over ssh.
# On macOS, /etc/zprofile moves these folders behind the system folders, so ~/.zprofile adds them again.
typeset -U path
user_path=(
  "$HOME/.local/bin"
  "${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims"
  "$HOME/.cargo/bin"
  /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin
)
path=($user_path $path)
export PATH

# Without a UTF-8 locale, zsh miscounts the width of the prompt character.
export LANG="${LANG:-C.UTF-8}"
export PAGER="less -R"
export RIPGREP_CONFIG_PATH="$HOME/.config/ripgrep/config"
export HOMEBREW_NO_ENV_HINTS=1

# Ubuntu's /etc/zsh/zshrc runs compinit unless this is set. Prezto's completion module runs it instead.
skip_global_compinit=1

# Settings for this computer only. The installer only adds to this file, and only when it keeps settings from an old setup.
[[ -r "${ZDOTDIR:-$HOME}/.zshenv.local" ]] && source "${ZDOTDIR:-$HOME}/.zshenv.local"
