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

# WezTerm shell integration is scoped to WezTerm sessions; Ghostty and other
# terminals keep their existing behavior. The script supplies OSC 7/133 and
# title/user-var hooks for local panes without changing remote machines.
if [[ "${TERM_PROGRAM:-}" == "WezTerm" && -r "/Applications/WezTerm.app/Contents/Resources/wezterm.sh" ]]; then
  source "/Applications/WezTerm.app/Contents/Resources/wezterm.sh"
fi

# >>> grok installer >>>
export PATH="$HOME/.grok/bin:$PATH"
fpath=(~/.grok/completions/zsh $fpath)
autoload -Uz compinit && compinit -C
# <<< grok installer <<<
