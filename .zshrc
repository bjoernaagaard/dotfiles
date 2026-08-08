# ~/.zshrc — interactive shell entry point
#
# This file sources the zsh configuration files in this order: options,
# tools, plugins, completions, keybindings, functions, aliases. The
# directory is ${XDG_CONFIG_HOME:-$HOME/.config}/zsh.
#
# PATH order
# ----------
# Mise shims remain last. Later shell integrations cannot put their own
# bin directories ahead of Mise-managed tool paths. Shims resolve tool
# versions for each invocation. Only automatic environment switching on
# cd needs the mise activate hooks. These hooks cost about 70 ms per
# shell start, so this file uses the shims instead.
#
# Dory CLI
# --------
# The markers # >>> dory cli >>> and # <<< dory cli <<< are functional.
# The dory CLI manages the block between them. Do not edit this block.

local _zsh_conf="${XDG_CONFIG_HOME:-$HOME/.config}/zsh"

source "$_zsh_conf/options.zsh"
source "$_zsh_conf/tools.zsh"
source "$_zsh_conf/plugins.zsh"
source "$_zsh_conf/completions.zsh"
source "$_zsh_conf/keybindings.zsh"
source "$_zsh_conf/functions.zsh"
source "$_zsh_conf/aliases.zsh"


MISE_SHIMS="$HOME/.local/share/mise/shims"
case ":$PATH:" in
  *":$MISE_SHIMS:"*) ;;
  *) export PATH="$MISE_SHIMS:$PATH" ;;
esac

# >>> dory cli >>>
DORY_CLI_BIN="/Users/bsa/.dory/bin"
case ":$PATH:" in
  *":$DORY_CLI_BIN:"*) ;;
  *) export PATH="$DORY_CLI_BIN:$PATH" ;;
esac
# <<< dory cli <<<