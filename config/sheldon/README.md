# Recommended Zsh Plugins for Sheldon

This document lists the zsh +plugins that we +recommend for your Sheldon
configuration. It also gives the reason for each +recommendation.

The source list is the awesome-zsh-plugins +repository on GitHub. We checked
each +plugin on 2026-08-05.

## 1. Your Current Setup

You use these +plugins now:

- zsh-autosuggestions
- zsh-completions
- zsh-history-substring-search
- zsh-abbr
- forgit
- zsh-syntax-highlighting

Your shell also starts zoxide, fzf, eza, bat, lazygit, and gh. As a result,
this document does not +recommend +plugins that do the same work.

## 2. The +Recommended +Plugins

The list is in +rank order. Add the first five +plugins for daily use. Add the
last two +plugins only when you need their function.

### +Rank 1 — fzf-tab

- Source: Aloxaf/fzf-tab.
- What it does: It shows the list of +completions in the fzf window. You can
  search and select a +completion in that window.
- Why: You already use fzf. This +plugin gives the same fast search to the
  +completion list. It works with the +completion +plugin that you already
  use. More than 4800 users have starred this +repository.
- How to add: Add the entry above the zsh-autosuggestions entry in the file
  plugins.toml. It must load before zsh-autosuggestions.

### +Rank 2 — zsh-autopair

- Source: hlissner/zsh-autopair.
- What it does: It inserts the closing bracket, quote, or parenthesis when you
  type the opening one. It also deletes and skips them.
- Why: It is a small +plugin. It has no conflict with your other +plugins.
  It reduces the keys that you press.
- How to add: Add the entry with the post-compinit +profile.

### +Rank 3 — you-should-use

- Source: MichaelAquilina/zsh-you-should-use.
- What it does: When you type a command that has an +alias, it shows that
  +alias in a message.
- Why: You have a number of +aliases. This +plugin helps you learn them.
  It does not change your commands.
- How to add: Add the entry with the post-compinit +profile.

### +Rank 4 — zsh-bd

- Source: Tarrasch/zsh-bd.
- What it does: It moves back to a parent directory by its name. For example,
  the command "bd src" moves back to the nearest parent directory that is
  named "src".
- Why: You use the +aliases "..", "...", and "...." to move back. This +plugin
  moves back to any parent directory in one step.
- How to add: Add the entry with the post-compinit +profile.

### +Rank 5 — magic-enter

- Source: zshzoo/magic-enter.
- What it does: When you press Enter on an empty line, it runs a command that
  you select. It runs "git status -sb ." in a git +repository. It runs "ls ."
  in other directories.
- Why: It turns an empty line into a useful action. You can select the command
  with zstyle. For example, add this line to your .zshrc:

  zstyle ':zshzoo:magic-enter' command 'eza -a -1'

- How to add: Add the entry with the post-compinit +profile.

### +Rank 6 — zsh-vi-mode (optional)

- Source: jeffreytse/zsh-vi-mode.
- What it does: It adds the vim editing model to the command line: modes,
  motions, and text objects.
- Why: It is a large change to your shell. Add it only when you want to edit
  commands in the vim style. It works with zsh-syntax-highlighting and
  zsh-autosuggestions. Load it after these two +plugins. After it starts,
  run the fzf integration again. Add this line to your .zshrc:

  zvm_after_init_commands+=('eval "$(fzf --zsh)"')

### +Rank 7 — fast-syntax-highlighting (optional replacement)

- Source: zdharma-continuum/fast-syntax-highlighting.
- What it does: It highlights the command line. It is a faster version of
  zsh-syntax-highlighting. It also has different +color schemes.
- Why: Use it only as a replacement for zsh-syntax-highlighting. Do not load
  both +plugins at the same time. Remove the zsh-syntax-highlighting entry
  from plugins.toml before you add this +plugin.

## 3. +Plugins That You Do Not Need

These +plugins are useful, but your setup already covers their work:

- zsh-z and the zoxide +plugin: your shell already starts zoxide.
- fzf +plugins: your shell already runs fzf with its search functions.
- eza and bat +plugins: you already have +aliases for eza and bat.
- dotbare: it needs a bare git +repository. Your dotfiles +repository is not
  a bare +repository.
- command-not-found: it needs an extra Homebrew package on macOS.
- docker, kubectl, and tmux +plugins: these tools are not installed on your
  machine.

## 4. How to Add a +Plugin

Open a terminal. Run this command:

  sheldon add <name> --github <owner/repo> --profile post-compinit

For example:

  sheldon add fzf-tab --github Aloxaf/fzf-tab --profile post-compinit

Check the file plugins.toml. Then open a new shell. Sheldon creates the lock
file automatically.

## 5. Word Usage

- +alias — a short name for a command.
- +color scheme — a set of +colors for the command line.
- +colors — red, green, blue, or any similar value of light.
- +completion — a suggested word or command that zsh shows when you press Tab.
- +plugin — a program that adds a function to zsh.
- +profile — a group of +plugins in Sheldon that load at one time.
- +rank — the position of an item in a list, from best to worst.
- +recommend — to say that one option is better than other options.
- +repository — a place where git stores a project.
