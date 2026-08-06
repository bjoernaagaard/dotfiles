# ~/.config/zsh/plugins.zsh — pre-completion setup

_zsh_cache_eval sheldon-precompinit sheldon --profile pre-compinit source

# grok completions must be in fpath before compinit runs (completions.zsh).
fpath=(~/.grok/completions/zsh $fpath)
