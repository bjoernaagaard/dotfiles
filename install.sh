#!/bin/sh
# The package lists split on spaces on purpose.
# shellcheck disable=SC2086
# Sets up zsh with Prezto, starship, and the command line tools that the config uses.
# Run it again at any time to update. Each run backs up files it replaces.
set -eu

repo_dir=$(cd "$(dirname "$0")" && pwd)
backup_dir="$HOME/.zsh-setup-backup/$(date +%Y%m%d-%H%M%S)"
tools="starship fzf zoxide fd eza bat ripgrep"
files=".zshenv .zprofile .zshrc .zpreztorc .config/starship.toml .config/bat/config .config/ripgrep/config"

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

install_system_packages() {
  missing=""
  for cmd in zsh git curl; do
    command -v "$cmd" >/dev/null 2>&1 || missing="$missing $cmd"
  done
  [ -z "$missing" ] && return 0
  say "Installing$missing"
  if [ "$(uname -s)" = Darwin ]; then
    command -v brew >/dev/null 2>&1 || fail "install$missing, or Homebrew from https://brew.sh, and run this again"
    brew install $missing
  elif command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update -qq && as_root apt-get install -y -qq $missing
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y -q $missing
  elif command -v pacman >/dev/null 2>&1; then
    as_root pacman -S --needed --noconfirm $missing
  elif command -v zypper >/dev/null 2>&1; then
    as_root zypper --non-interactive install $missing
  elif command -v apk >/dev/null 2>&1; then
    as_root apk add $missing
  else
    fail "install$missing with your package manager, and run this again"
  fi
}

install_mise() {
  export PATH="$HOME/.local/bin:$PATH"
  if ! command -v mise >/dev/null 2>&1; then
    say "Installing mise"
    curl -fsSL https://mise.run | sh
  fi
  say "Installing $tools"
  mise use -g --yes $tools
}

install_prezto() {
  if [ -d "$HOME/.zprezto/.git" ]; then
    say "Updating Prezto"
    git -C "$HOME/.zprezto" pull -q --ff-only
  else
    say "Installing Prezto"
    git clone -q https://github.com/sorin-ionescu/prezto.git "$HOME/.zprezto"
  fi
  git -C "$HOME/.zprezto" submodule update -q --init --recursive
}

copy_files() {
  say "Copying config files"
  for file in $files; do
    source_file="$repo_dir/home/$file"
    target="$HOME/$file"
    [ -f "$source_file" ] || fail "missing $source_file"
    if [ -e "$target" ] || [ -L "$target" ]; then
      if [ -f "$target" ] && cmp -s "$source_file" "$target"; then
        continue
      fi
      mkdir -p "$(dirname "$backup_dir/$file")"
      mv "$target" "$backup_dir/$file"
      echo "    backed up ~/$file"
    fi
    mkdir -p "$(dirname "$target")"
    cp "$source_file" "$target"
    echo "    wrote ~/$file"
  done
  if [ -d "$backup_dir" ]; then
    echo "    old files are in ${backup_dir#"$HOME"/}"
  fi
}

write_completions() {
  say "Writing completions"
  dir="$HOME/.local/share/zsh/site-functions"
  mkdir -p "$dir"
  mise completion zsh > "$dir/_mise"
  mise exec -- starship completions zsh > "$dir/_starship"
  mise exec -- fd --gen-completions zsh > "$dir/_fd"
  mise exec -- rg --generate complete-zsh > "$dir/_rg"
  mise exec -- bat --completion zsh > "$dir/_bat"
  rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/prezto/zcompdump"*
}

set_login_shell() {
  zsh_path=$(command -v zsh)
  case "${SHELL:-}" in */zsh) return 0 ;; esac
  say "Making zsh your login shell"
  if ! grep -qx "$zsh_path" /etc/shells; then
    echo "$zsh_path" | as_root tee -a /etc/shells >/dev/null
  fi
  chsh -s "$zsh_path" 2>/dev/null ||
    as_root chsh -s "$zsh_path" "$(id -un)" ||
    echo "    run this yourself: chsh -s $zsh_path"
}

install_system_packages
install_mise
install_prezto
copy_files
write_completions
set_login_shell

say "Done. Open a new terminal, or run: exec zsh"
