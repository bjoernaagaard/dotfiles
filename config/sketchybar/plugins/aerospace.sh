#!/usr/bin/env bash

set -euo pipefail

SKETCHYBAR="${SKETCHYBAR:-$(command -v sketchybar || true)}"
if [[ -z "$SKETCHYBAR" ]]; then
  for candidate in /opt/homebrew/bin/sketchybar /usr/local/bin/sketchybar; do
    if [[ -x "$candidate" ]]; then
      SKETCHYBAR="$candidate"
      break
    fi
  done
fi
workspace="${1:-}"

if [[ -z "$SKETCHYBAR" || -z "$workspace" || -z "${NAME:-}" ]]; then
  exit 0
fi

if [[ "${FOCUSED_WORKSPACE:-}" == "$workspace" ]]; then
  "$SKETCHYBAR" --set "$NAME" \
    background.drawing=on \
    background.color=0xff88c0d0 \
    label.color=0xff2e3440 \
    label.font="Hack Nerd Font:Bold:13.0"
else
  "$SKETCHYBAR" --set "$NAME" \
    background.drawing=off \
    label.color=0xffd8dee9 \
    label.font="Hack Nerd Font:Regular:13.0"
fi
