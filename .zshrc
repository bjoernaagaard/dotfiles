# ~/.zshrc — interactive shell entry point
local _zsh_conf="${XDG_CONFIG_HOME:-$HOME/.config}/zsh"

source "$_zsh_conf/options.zsh"
source "$_zsh_conf/tools.zsh"
source "$_zsh_conf/plugins.zsh"
source "$_zsh_conf/completions.zsh"
source "$_zsh_conf/keybindings.zsh"
source "$_zsh_conf/functions.zsh"
source "$_zsh_conf/aliases.zsh"

# Keep Mise activation last so later shell integrations cannot put their own
# bin directories ahead of Mise-managed tool paths.
eval "$(mise activate zsh)"
