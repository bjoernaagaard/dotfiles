#!/usr/bin/env bash

set -u

SKETCHYBAR=/opt/homebrew/bin/sketchybar
workspace="${1:-}"

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
