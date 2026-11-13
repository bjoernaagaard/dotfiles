#!/bin/sh
# Sets up zsh with Prezto, starship, and the command line tools that the config uses.
# It works on a new computer and on one with an old, partial, or unknown zsh setup.
# Run it again at any time to update. Each run backs up every file it replaces.
#
# Usage: install.sh [--dry-run]
#   --dry-run  shows what the installer finds and what it would change, and changes nothing
#
# The package and file lists split on spaces on purpose.
# shellcheck disable=SC2086
set -eu

repo_dir=$(cd "$(dirname "$0")" && pwd)
stamp=$(date +%Y%m%d-%H%M%S)
backup_dir="$HOME/.zsh-setup-backup/$stamp"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
tools="starship fzf zoxide fd eza bat ripgrep"
# zsh startup files. Each one loads a .local file that keeps the user's own settings.
zsh_files=".zshenv .zprofile .zshrc"
# Other config files. The installer replaces them and keeps the old copy in the backup.
other_files=".zpreztorc .config/starship.toml .config/bat/config .config/ripgrep/config"
dry_run=""
notes=""

case "${1:-}" in
  --dry-run) dry_run=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
item() { printf '    %s\n' "$*"; }
note() { notes="$notes$*
"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
short() { printf '%s' "$1" | sed "s#^$HOME#~#"; }
has() { command -v "$1" >/dev/null 2>&1; }

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

# The login shell from the user database. $SHELL keeps the old value until the next login.
login_shell() {
  user=$(id -un)
  if [ "$(uname -s)" = Darwin ]; then
    dscl . -read "/Users/$user" UserShell 2>/dev/null | sed 's/^UserShell: //'
  elif has getent; then
    getent passwd "$user" | cut -d: -f7
  else
    printf '%s' "${SHELL:-}"
  fi
}

# Folder that zsh reads its startup files from. /etc/zshenv can move it with ZDOTDIR,
# and an old ~/.zshenv can too. zsh -f reads only /etc/zshenv.
find_zsh_folders() {
  zdot=$HOME
  old_zdot=$HOME
  has zsh || return 0
  global=$(zsh -f -c 'print -r -- ${ZDOTDIR:-}' 2>/dev/null </dev/null || true)
  [ -n "$global" ] && zdot=$global
  current=$(zsh -c 'print -r -- ${ZDOTDIR:-}' 2>/dev/null </dev/null || true)
  [ -n "$current" ] && old_zdot=$current
  return 0
}

# The path where zsh reads a file from, before the installer runs.
old_path() {
  case $1 in
    .zshenv) printf '%s/.zshenv' "$zdot" ;;
    .zshrc | .zprofile) printf '%s/%s' "$old_zdot" "$1" ;;
    *) printf '%s/%s' "$HOME" "$1" ;;
  esac
}

new_path() {
  case $1 in
    .zshenv | .zshrc | .zprofile) printf '%s/%s' "$zdot" "$1" ;;
    *) printf '%s/%s' "$HOME" "$1" ;;
  esac
}

# Writes every version of home/<file> from the repository's history into the stage folder,
# so the installer can tell an old copy of this config from somebody else's file.
past_versions() {
  dir="$stage/versions/$1"
  mkdir -p "$dir"
  cp "$repo_dir/home/$1" "$dir/current"
  if git -C "$repo_dir" rev-parse --git-dir >/dev/null 2>&1; then
    for commit in $(git -C "$repo_dir" rev-list HEAD -- "home/$1"); do
      git -C "$repo_dir" show "$commit:home/$1" >"$dir/$commit" 2>/dev/null || rm -f "$dir/$commit"
    done
  fi
  printf '%s' "$dir"
}

# Prints one word about an existing file:
#   missing   no file
#   same      matches the new file
#   stale     matches an older version of this config
#   edited    an older version of this config with changes
#   foreign   anything else
classify() {
  old=$1
  [ -f "$old" ] || { echo missing; return; }
  versions=$(past_versions "$2")
  cmp -s "$old" "$versions/current" && { echo same; return; }
  best=""
  best_missing=999999
  for version in "$versions"/*; do
    cmp -s "$old" "$version" && { echo stale; return; }
    missing=$(diff "$version" "$old" | grep -c '^<' || true)
    if [ "$missing" -lt "$best_missing" ]; then best=$version; best_missing=$missing; fi
  done
  total=$(grep -c . "$best" || true)
  if [ $((best_missing * 2)) -le "$total" ]; then
    cp "$best" "$stage/closest"
    echo edited
  else
    echo foreign
  fi
}

# Prints the lines of an old zsh file that the user still needs.
carry_over() {
  old=$1
  new=$repo_dir/home/$2
  case $3 in
    edited) diff "$stage/closest" "$old" | sed -n 's/^> //p' | awk -f "$repo_dir/lib/carry-over.awk" "$new" - ;;
    foreign) awk -f "$repo_dir/lib/carry-over.awk" "$new" "$old" ;;
  esac
}

# Prints exports and aliases from bash files, for people who switch from bash to zsh.
# It skips the lines that came with the system (in /etc/skel) and aliases the new config defines.
carry_over_bash() {
  for file in .bash_profile .bashrc .bash_aliases .profile; do
    [ -f "$HOME/$file" ] || continue
    : >"$stage/skel"
    [ -f "/etc/skel/$file" ] && cp "/etc/skel/$file" "$stage/skel"
    lines=$(grep -E '^[[:space:]]*(export|alias)[[:space:]]' "$HOME/$file" |
      grep -Fvx -f "$stage/skel" |
      grep -Ev 'PS1|PS2|PROMPT_COMMAND|HIST|BASH|SHELL=|TERM=|ZDOTDIR|\\$|mise activate|starship|zoxide|fzf' |
      grep -Fv -f "$stage/our-aliases" || true)
    [ -n "$lines" ] || continue
    printf '\n# Carried over from ~/%s on %s.\n%s\n' "$file" "$stamp" "$lines"
  done
}

detect() {
  say "Checking the current setup"
  item "login shell: $(login_shell)"
  if has zsh; then item "zsh: $(zsh --version)"; else item "zsh: not installed"; fi
  [ "$zdot" != "$HOME" ] && item "/etc/zshenv sets ZDOTDIR to $(short "$zdot"), so the zsh files go there"
  [ "$old_zdot" != "$zdot" ] && item "the old ~/.zshenv sets ZDOTDIR to $(short "$old_zdot")"
  if has mise; then item "mise: $(mise --version 2>/dev/null | head -n 1)"; else item "mise: not installed"; fi

  for dir in .oh-my-zsh .zinit .local/share/zinit .antigen .zplug .zgen .zgenom .antidote .zprezto; do
    [ -d "$HOME/$dir" ] || continue
    case $dir in
      .zprezto) item "Prezto: ~/.zprezto" ;;
      *) item "another zsh framework: ~/$dir"
        note "The new config doesn't load ~/$dir. Delete the folder when you no longer need it." ;;
    esac
  done
  [ -f "$HOME/.p10k.zsh" ] && item "Powerlevel10k config: ~/.p10k.zsh, which starship replaces"

  for file in $zsh_files $other_files; do
    old=$(old_path "$file")
    [ -L "$old" ] && item "$(short "$old") is a link to $(short "$(readlink "$old")")"
    state=$(classify "$old" "$file")
    case $state in
      missing) item "$(short "$old"): none" ;;
      same) item "$(short "$old"): up to date" ;;
      stale) item "$(short "$old"): older version of this config" ;;
      edited) item "$(short "$old"): older version of this config, with your changes" ;;
      foreign) item "$(short "$old"): your own file" ;;
    esac
  done
}

install_system_packages() {
  missing=""
  for cmd in zsh git curl; do
    has "$cmd" || missing="$missing $cmd"
  done
  [ -z "$missing" ] && return 0
  say "Installing$missing"
  if [ "$(uname -s)" = Darwin ]; then
    has brew || fail "install$missing, or Homebrew from https://brew.sh, and run this again"
    brew install $missing
  elif has apt-get; then
    as_root apt-get update -qq && as_root apt-get install -y -qq $missing
  elif has dnf; then
    as_root dnf install -y -q $missing
  elif has pacman; then
    as_root pacman -S --needed --noconfirm $missing
  elif has zypper; then
    as_root zypper --non-interactive install $missing
  elif has apk; then
    as_root apk add $missing
  else
    fail "install$missing with your package manager, and run this again"
  fi
}

install_mise() {
  if ! has mise; then
    say "Installing mise"
    curl -fsSL https://mise.run | sh
  elif [ "$(command -v mise)" = "$HOME/.local/bin/mise" ]; then
    # An old mise may not know the tools or flags below. A package manager's mise updates itself.
    say "Updating mise"
    mise self-update --yes >/dev/null 2>&1 || item "mise couldn't update itself, so it keeps $(mise --version)"
  fi
  say "Installing $tools"
  mise use -g --yes $tools
}

install_prezto() {
  prezto=$HOME/.zprezto
  if [ -d "$prezto/.git" ] &&
    git -C "$prezto" remote get-url origin 2>/dev/null | grep -q 'sorin-ionescu/prezto' &&
    [ -z "$(git -C "$prezto" status --porcelain 2>/dev/null)" ] &&
    git -C "$prezto" pull -q --ff-only 2>/dev/null; then
    say "Updated Prezto"
  else
    if [ -e "$prezto" ]; then
      # A fork, a copy without Git, or a clone with local changes. Start over from a clean clone.
      mkdir -p "$backup_dir"
      mv "$prezto" "$backup_dir/.zprezto"
      note "The old ~/.zprezto is in $(short "$backup_dir")/.zprezto, including any modules you added to it."
    fi
    say "Installing Prezto"
    git clone -q https://github.com/sorin-ionescu/prezto.git "$prezto"
  fi
  git -C "$prezto" submodule update -q --init --recursive
}

# Writes the new files and the .local files into the stage folder. Nothing in the home folder changes.
stage_files() {
  grep -o '^alias [^=]*=' "$repo_dir/home/.zshrc" >"$stage/our-aliases"
  for file in $zsh_files; do
    old=$(old_path "$file")
    state=$(classify "$old" "$file")
    case $state in edited | foreign) ;; *) continue ;; esac
    carried=$(carry_over "$old" "$file" "$state")
    [ -n "$carried" ] || continue
    printf '\n# Carried over from %s on %s.\n%s\n' "$(short "$old")" "$stamp" "$carried" >>"$stage/$file.local"
  done
  case "$(login_shell)" in
    */zsh) ;;
    *) if ! grep -Eqs '^(# )?# Carried over from ~/\.(bash|profile)' "$(new_path .zshrc).local"; then
        carry_over_bash >>"$stage/.zshrc.local"
      fi ;;
  esac
  for file in $zsh_files; do
    section=$stage/$file.local
    [ -s "$section" ] || continue
    # If the carried lines don't parse as zsh, keep them as comments so the shell still starts.
    if has zsh && ! zsh -n "$section" 2>/dev/null; then
      sed 's/^/# /' "$section" >"$section.tmp"
      printf '\n# These lines from the old setup have a zsh syntax error, so the installer turned them into comments.\n' >"$section"
      cat "$section.tmp" >>"$section"
      rm -f "$section.tmp"
      note "Some old settings had a syntax error, so they're comments in $(short "$(new_path "$file")").local. Fix them and remove the # signs."
    fi
  done
  # The .local file loads last, so an old alias with the same name wins over the new one.
  if [ -s "$stage/.zshrc.local" ]; then
    replaced=$(grep -o '^alias [^=]*=' "$stage/.zshrc.local" | grep -Fx -f "$stage/our-aliases" |
      sed 's/^alias //; s/=$//' | sort -u | tr '\n' ' ' || true)
    if [ -n "$replaced" ]; then
      note "Your old aliases replace these from the new config: ${replaced% }. To use the new ones, delete them from $(short "$(new_path .zshrc)").local."
    fi
  fi
}

show_plan() {
  say "Settings the installer keeps from the old setup"
  found=""
  for file in $zsh_files; do
    [ -s "$stage/$file.local" ] || continue
    found=1
    echo "    --- added to $(short "$(new_path "$file")").local"
    sed 's/^/    /' "$stage/$file.local"
  done
  [ -n "$found" ] || item "none"
}

back_up() {
  [ -e "$1" ] || [ -L "$1" ] || return 0
  relative=${1#"$HOME"/}
  mkdir -p "$(dirname "$backup_dir/$relative")"
  mv "$1" "$backup_dir/$relative"
  item "backed up $(short "$1")"
}

apply_files() {
  say "Writing config files"
  for file in $zsh_files $other_files; do
    new=$(new_path "$file")
    old=$(old_path "$file")
    source_file=$repo_dir/home/$file
    [ -f "$source_file" ] || fail "missing $source_file"
    # The old file may sit in another folder because of ZDOTDIR. Move it out of the way too.
    [ "$old" != "$new" ] && back_up "$old"
    if [ -f "$new" ] && [ ! -L "$new" ] && cmp -s "$source_file" "$new"; then
      continue
    fi
    back_up "$new"
    mkdir -p "$(dirname "$new")"
    cp "$source_file" "$new"
    item "wrote $(short "$new")"
  done
  for file in $zsh_files; do
    [ -s "$stage/$file.local" ] || continue
    local_file=$(new_path "$file").local
    [ -f "$local_file" ] && mkdir -p "$backup_dir" && cp "$local_file" "$backup_dir/$(basename "$local_file")"
    cat "$stage/$file.local" >>"$local_file"
    item "kept your settings in $(short "$local_file")"
  done
  # Old completion caches can list commands that no longer exist.
  rm -f "$zdot"/.zcompdump* "$HOME"/.zcompdump*
}

write_completions() {
  say "Writing completions"
  dir="$HOME/.local/share/zsh/site-functions"
  mkdir -p "$dir"
  mise completion zsh >"$dir/_mise"
  mise exec -- starship completions zsh >"$dir/_starship"
  mise exec -- fd --gen-completions zsh >"$dir/_fd"
  mise exec -- rg --generate complete-zsh >"$dir/_rg"
  mise exec -- bat --completion zsh >"$dir/_bat"
  rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/prezto/zcompdump"*
}

set_login_shell() {
  zsh_path=$(command -v zsh)
  case "$(login_shell)" in */zsh) return 0 ;; esac
  say "Making zsh your login shell"
  if ! grep -qx "$zsh_path" /etc/shells; then
    echo "$zsh_path" | as_root tee -a /etc/shells >/dev/null
  fi
  chsh -s "$zsh_path" 2>/dev/null ||
    as_root chsh -s "$zsh_path" "$(id -un)" ||
    note "The installer couldn't change your login shell. Run this yourself: chsh -s $zsh_path"
}

# Starts an interactive zsh and reports anything it prints as an error.
verify() {
  say "Checking that zsh starts"
  errors=$(cd "$HOME" && zsh -i -c exit 2>&1 >/dev/null </dev/null || true)
  if [ -z "$errors" ]; then
    item "zsh starts with no errors"
  else
    item "zsh printed this while it started:"
    printf '%s\n' "$errors" | sed 's/^/      /'
    note "zsh printed errors while it started. Look for the cause in $(short "$zdot")/.zshrc.local and $(short "$zdot")/.zshenv.local."
  fi
}

export PATH="$HOME/.local/bin:$PATH"
find_zsh_folders
detect
stage_files
show_plan

if [ -n "$dry_run" ]; then
  say "Dry run, so nothing changed"
  exit 0
fi

install_system_packages
find_zsh_folders
install_mise
install_prezto
apply_files
write_completions
set_login_shell
verify

if [ -d "$backup_dir" ]; then
  note "Every file the installer replaced is in $(short "$backup_dir")."
fi
if [ -n "$notes" ]; then
  say "Notes"
  printf '%s' "$notes" | sed 's/^/    /'
fi
say "Done. Open a new terminal, or run: exec zsh"
