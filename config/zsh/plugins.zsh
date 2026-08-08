# =============================================================================
# plugins.zsh — pre-completion setup
# =============================================================================
#
# The completion directories must be in fpath before compinit runs.

_zsh_cache_eval sheldon-precompinit sheldon --profile pre-compinit source

fpath=(~/.config/zsh/completions ~/.grok/completions/zsh $fpath)
