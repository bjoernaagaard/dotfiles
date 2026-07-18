# ~/.config/zsh/functions.zsh — shell functions

# yazi: change directory on exit
function y() {
  local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
  command yazi "$@" --cwd-file="$tmp"
  IFS= read -r -d '' cwd < "$tmp"
  [ "$cwd" != "$PWD" ] && [ -d "$cwd" ] && builtin cd -- "$cwd"
  command rm -f -- "$tmp"
}

# herdr
# Launch Herdr into an existing local or reachable remote session by default.
# Pass arguments through unchanged for normal commands (for example,
# `herdr status` or `herdr --remote hyperion --session default`).
function herdr() {
  local herdr_bin="$HOME/.local/bin/herdr"
  if (( $# > 0 )); then
    "$herdr_bin" "$@"
    return
  fi

  if ! command -v fzf >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    "$herdr_bin"
    return
  fi

  local choice kind host session
  local local_host="${HOST%%.*}"
  local -a entries
  entries=()

  # Keep this computer's default session available even when it isn't running.
  entries+=("local"$'\t'"$local_host"$'\t'"default"$'\t'"local  /  $local_host  /  default")

  # Local sessions are always cheap to enumerate.
  while IFS=$'\t' read -r kind host session label; do
    [[ -n "$session" && "$session" != default ]] && entries+=("$kind"$'\t'"$host"$'\t'"$session"$'\t'"$label")
  done < <("$herdr_bin" session list --json 2>/dev/null | jq -r --arg host "$local_host" '.sessions[] | select(.running == true) | ["local", $host, .name, ("local  /  " + $host + "  /  " + .name)] | @tsv')

  # SSH aliases come from ~/.ssh/config. Override with HERDR_REMOTE_HOSTS when
  # a host is not declared there (space-separated aliases are accepted).
  local -a remote_hosts
  if [[ -n "${HERDR_REMOTE_HOSTS:-}" ]]; then
    remote_hosts=(${=HERDR_REMOTE_HOSTS})
  else
    remote_hosts=(${(@f)$(awk '/^[[:space:]]*Host[[:space:]]+/ { for (i = 2; i <= NF; i++) if ($i !~ /[*?!]/) print $i }' "$HOME/.ssh/config" 2>/dev/null | sort -u)})
  fi

  for host in $remote_hosts; do
    # A remote Herdr server may be alive even when a non-interactive probe is
    # unavailable (for example, Tailscale is down or SSH needs a key prompt).
    # The default session is the supported durable remote identity, so keep it
    # in the picker and let Herdr perform the real attach interactively.
    entries+=("remote"$'\t'"$host"$'\t'"default"$'\t'"remote (tailscale)  /  $host  /  default")

    while IFS=$'\t' read -r kind remote_host session label; do
      [[ -n "$session" && "$session" != default ]] && entries+=("$kind"$'\t'"$remote_host"$'\t'"$session"$'\t'"$label")
    done < <(ssh -o BatchMode=yes -o ConnectTimeout=2 "$host" '$HOME/.local/bin/herdr session list --json' 2>/dev/null | jq -r --arg host "$host" '.sessions[] | select(.running == true) | ["remote", $host, .name, ("remote (tailscale)  /  " + $host + "  /  " + .name)] | @tsv')
  done

  if (( ${#entries[@]} == 0 )); then
    print "No running Herdr sessions found; starting the default session."
    "$herdr_bin"
    return
  fi

  choice=$(printf '%s\n' "${entries[@]}" | fzf --delimiter=$'\t' --with-nth=4 --prompt='Attach Herdr session > ' --height=40% --layout=reverse) || return
  IFS=$'\t' read -r kind host session _ <<< "$choice"
  if [[ "$kind" == remote ]]; then
    "$herdr_bin" --remote "$host" --session "$session"
  else
    "$herdr_bin" --session "$session"
  fi
}