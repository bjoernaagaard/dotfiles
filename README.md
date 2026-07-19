# Dotfiles

## AeroSpace on macOS

This repo uses AeroSpace as the window/workspace manager and SketchyBar as the
visual workspace switcher. The configuration lives in
[`config/aerospace/aerospace.toml`](config/aerospace/aerospace.toml) and
[`config/sketchybar/`](config/sketchybar/).

The event flow is:

1. AeroSpace changes workspace focus.
2. `exec-on-workspace-change` triggers the custom SketchyBar event
   `aerospace_workspace_change`.
3. Each `space.N` item runs the plugin with the focused workspace in
   `FOCUSED_WORKSPACE`.
4. Clicking an item runs `aerospace workspace N`.

The current bindings use `ctrl` as AeroSpace's logical modifier. On the
Keychron K10 profile, Karabiner swaps the physical Ctrl and Command/Windows
keys, so the physical Command/Windows key is the AeroSpace leader:

| Shortcut | Action |
| --- | --- |
| `Ctrl/Command-Windows + h/j/k/l` | Focus left/down/up/right |
| `Ctrl/Command-Windows + Shift + h/j/k/l` | Move the window |
| `Ctrl/Command-Windows + 1..9` | Switch workspace |
| `Ctrl/Command-Windows + Shift + 1..9` | Move window to workspace |
| `Ctrl/Command-Windows + /` | Toggle horizontal/vertical tiling |
| `Ctrl/Command-Windows + ,` | Toggle accordion layout |
| `Ctrl/Command-Windows + Shift-Space` | Toggle floating/tiling |
| `Ctrl/Command-Windows + Shift-;`, then `r` | Flatten the workspace tree |

Install or refresh the managed links and packages with the repo's normal mise
bootstrap flow, then reload both services when changing configuration:

```sh
mise run bootstrap
aerospace reload-config
sketchybar --reload
```

SketchyBar is event-driven here rather than polling. Its custom event and
startup trigger are intentional: the bar must paint the already-focused
workspace before the first workspace switch.

### Optional app routing

Many AeroSpace users give workspaces a role and route new windows by bundle
ID. Keep that policy local to AeroSpace, for example:

```toml
on-window-detected = [
  { if.app-id = 'com.microsoft.VSCode', run = 'move-node-to-workspace 2' },
  { if.app-id = 'app.zen-browser.zen', run = 'move-node-to-workspace 3' },
  { if.app-id = 'com.google.Chrome', run = 'move-node-to-workspace 3' },
]
```

Discover IDs with `aerospace list-apps` or
`mdls -name kMDItemCFBundleIdentifier -r /Applications/App.app`. The repo
leaves these rules opt-in because workspace roles are personal and automatic
routing can surprise you when the same app is used for different projects.

### Companion add-ons

- `borders` is wired as an optional focused-window outline. Install it with
  `brew tap FelixKratz/formulae && brew install borders`; the managed
  `config/borders/bordersrc` is then picked up when AeroSpace starts. The
  AeroSpace guard silently skips it when it is not installed.
- Karabiner-Elements owns keyboard remapping only. Keep workspace bindings in
  AeroSpace so the bar and CLI use the same workspace model.
- BetterTouchTool or an AeroSpace swipe helper can map trackpad gestures to
  `aerospace eval 'list-workspaces --monitor mouse --visible | workspace --stdin next; workspace next --wrap-around'`
  and the equivalent `prev` command.
- A Raycast AeroSpace extension is useful as a searchable command palette when
  a shortcut is not yet muscle memory.
- AltTab, Rectangle Pro, and Stats can coexist with this setup; avoid giving
  them the same global shortcuts as AeroSpace or Karabiner.

For diagnosis, run `sketchybar` directly to see script errors, use
`sketchybar --query bar` to inspect the live items, and use
`aerospace list-workspaces --all` to compare the workspace set with the bar.
