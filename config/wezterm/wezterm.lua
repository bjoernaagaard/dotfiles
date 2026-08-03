-- ============================================================================
-- wezterm.lua — PROPOSED v2: "WezTerm replaces Herdr" edition (proposal only)
-- Target: nightly 20260731-083216-d69264df (every option validated against it)
--
-- DNA:
--   • Ghostty parity  ~/.dotfiles/config/ghostty/config
--   • Herdr REPLACEMENT — key chords, prefix table, panes/tabs, detach,
--     session persistence, sidebar
--   • Karabiner owns the global keymap; chords below are app-level and were
--     proven free by Herdr itself (they reach Herdr today)
--   • 2026 nightly features from wezterm.org/config/lua/config/index.html
--
-- Herdr features CONCEDED (no WezTerm equivalent):
--   • remote_image_paste   → no clipboard-image action (kitty graphics works,
--                            `wezterm imgcat` locally; nothing pushes a local
--                            image through an ssh session)
--   • agent sidebar        → sidebar below is a plain 30% shell pane, not an
--                            agent-status tree (no agent awareness in WezTerm)
--   • herdr CLI/agent ops  → closest analog is `wezterm cli` + `wezterm connect`
--   • toast clipboard indicator → WezTerm has no clipboard event; OSC toasts
--                            are handled via notification_handling below
--   • ui.sound             → audible_bell is terminal-bell only (default on)
--   • manage_ssh_config    → WezTerm auto-populates ssh_domains from
--                            ~/.ssh/config (block below)
--   • switch_ascii_input_source_in_prefix → OS-level IME switching, not exposed
--   • scrollback_limit_bytes → WezTerm scrollback is line-based
--
-- Removed-option watch-list (this nightly): window_background_opacity still
-- works but is undocumented; clipboard_paste_bracketed and scrollback_editor
-- are GONE (bracketed paste is always-on); font_antialias/font_hinting are
-- deprecated no-ops; the layered `background` API requires a `source`.
-- ============================================================================
local wezterm = require("wezterm")
local act = wezterm.action

local config = wezterm.config_builder()

-- ▸ Appearance — ghostty parity ───────────────────────────────────────────────
-- ghostty: font-family = PaperMono NF, size 14. WezTerm needs the full family
-- name ("PaperMono NF" shorthand is Ghostty-only). Maple Mono NF as fallback.
config.font = wezterm.font_with_fallback({ "PaperMono Nerd Font Mono", "Maple Mono NF" })
config.font_size = 14.0

-- ghostty theme = "Material Design Colors" == WezTerm's built-in
-- "MaterialDesignColors" (same iTerm2-origin scheme; verified in binary).
config.color_scheme = "MaterialDesignColors"

-- 2× HiDPI on the JAPANNEXT 6K (72 pt/inch × scale 2).
config.dpi = 144.0

-- ghostty: window-padding-x/y = 10 (+balance), window 160×80, decorations on
config.window_padding = { left = 10, right = 10, top = 10, bottom = 10 }
config.initial_cols = 160
config.initial_rows = 80
config.window_decorations = "TITLE | RESIZE"
config.use_resize_increments = true -- ghostty window-step-resize

-- ghostty: background-opacity 0.98 + background-blur
config.window_background_opacity = 0.98
config.macos_window_background_blur = 20

-- ▸ Rendering — 2026 nightly picks ────────────────────────────────────────────
config.front_end = "WebGpu"                  -- Metal on macOS (default: OpenGL)
config.webgpu_power_preference = "LowPower"  -- M4 integrated GPU
config.text_min_contrast_ratio = 4.5         -- nightly-only WCAG AA floor
config.ui_key_cap_rendering = "AppleSymbols" -- ⌘⌥⇧⌃ in command palette
config.use_cap_height_to_scale_fallback_fonts = true

-- ▸ Cursor, mouse, selection — ghostty parity ────────────────────────────────
config.default_cursor_style = "SteadyBar"
config.cursor_blink_rate = 0
config.hide_mouse_cursor_when_typing = false -- ghostty mouse-hide-while-typing=false
config.selection_word_boundary = " ,│`|:\"'()[]{}<>\t"
-- copy-on-select to clipboard is the WezTerm default (mouse Up, no mods).

-- ▸ Scrollback ────────────────────────────────────────────────────────────────
-- ghostty: 50M. CAVEAT: WezTerm keeps scrollback in RAM (Ghostty is
-- disk-backed); 50M lines ≈ several GB when full — lower if memory matters.
config.scrollback_lines = 50000000

-- ▸ Input / macOS ─────────────────────────────────────────────────────────────
-- ghostty: macos-option-as-alt = true → left Option = Alt/Meta, right keeps
-- macOS composition for international input.
config.send_composed_key_when_left_alt_is_pressed = false
config.send_composed_key_when_right_alt_is_pressed = true
-- Keep Herdr-style Option+Shift chords out of the IME (default "SHIFT" would
-- route them through the IME and can swallow them).
config.macos_forward_to_ime_modifier_mask = ""
config.enable_kitty_keyboard = true -- kitty keyboard protocol (Ghostty parity)
config.enable_kitty_graphics = true -- kitty graphics protocol (images)

-- ▸ Multiplexing — Herdr session/detach replacement ──────────────────────────
-- Runs a mux SERVER process; the GUI is a client. Panes survive GUI quit
-- (Herdr's detach), and relaunching WezTerm reattaches (Herdr's resume).
--   detach:        option+shift+q  (or prefix+q) → DetachDomain
--   reattach:      launch WezTerm again, or `wezterm connect unix` from a shell
--   remote control: `wezterm cli list`, `wezterm cli split-pane --help`, …
config.unix_domains = { { name = "unix" } }
config.default_gui_startup_args = { "connect", "unix" }

-- ▸ Herdr-style helpers: last-pane + sidebar ─────────────────────────────────
local focused_panes = {} -- window_id -> pane_id currently focused
local last_panes = {}    -- window_id -> pane_id focused before that
local sidebar_panes = {} -- window_id -> pane_id of the sidebar pane

-- update-right-status doubles as a focus poller for the last-pane tracker
-- (there is no pane-focus-changed event in WezTerm). The 200ms interval is
-- the tracker's granularity; the status text is unchanged.
config.status_update_interval = 200

local function record_focus(window, pane)
    local wid = window:window_id()
    local cur = pane:pane_id()
    if focused_panes[wid] ~= cur then
        last_panes[wid] = focused_panes[wid]
        focused_panes[wid] = cur
    end
end

-- prefix+tab / herdr "last_pane": jump back to the previously focused pane.
local function activate_last_pane(window, _)
    local last = last_panes[window:window_id()]
    local pane = last and wezterm.mux.get_pane(last)
    if pane then
        pane:activate()
    end
end

-- prefix+b / option+shift+b: toggle a 30%-width right-side pane (Herdr
-- sidebar replacement — point it at a real program: btop, nnn, $SHELL, …).
-- First press spawns it focused; press again while focused to close it.
local function toggle_sidebar(window, pane)
    local wid = window:window_id()
    local existing = sidebar_panes[wid] and wezterm.mux.get_pane(sidebar_panes[wid])
    if existing then
        if pane:pane_id() == existing:pane_id() then
            window:perform_action(act.CloseCurrentPane { confirm = false }, existing)
            sidebar_panes[wid] = nil
        else
            existing:activate()
        end
    else
        window:perform_action(
            act.SplitPane {
                direction = "Right",
                size = { Percent = 30 },
                command = { args = { os.getenv("SHELL") or "zsh" } },
            },
            pane
        )
        sidebar_panes[wid] = window:active_pane():pane_id()
    end
end

-- ▸ Key tables — Herdr prefix mode + resize mode ──────────────────────────────
-- Leader key: CTRL+Space (Herdr's prefix). one_shot pops the table after the
-- first key; timeout aborts a stray prefix. Esc cancels explicitly.
config.key_tables = {
    herdr = {
        { key = "Tab", action = wezterm.action_callback(activate_last_pane) },
        { key = "LeftArrow",  action = act.ActivatePaneDirection "Left" },
        { key = "DownArrow",  action = act.ActivatePaneDirection "Down" },
        { key = "UpArrow",    action = act.ActivatePaneDirection "Up" },
        { key = "RightArrow", action = act.ActivatePaneDirection "Right" },
        { key = "d", action = act.SplitVertical { domain = "CurrentPaneDomain" } },  -- herdr split_vertical
        { key = "c", action = act.SplitHorizontal { domain = "CurrentPaneDomain" } }, -- herdr split_horizontal
        { key = "x", action = act.CloseCurrentPane { confirm = false } },                    -- herdr close_pane
        { key = "r", action = act.ActivateKeyTable { name = "resize", replace_current = true } },
        { key = "t", action = act.SpawnTab "CurrentPaneDomain" },                  -- herdr new_tab
        { key = ",", action = act.ActivateTabRelative(-1) },                          -- herdr previous_tab
        { key = ".", action = act.ActivateTabRelative(1) },                           -- herdr next_tab
        { key = "w", action = act.CloseCurrentTab { confirm = false } },                  -- herdr close_tab
        { key = "b", action = wezterm.action_callback(toggle_sidebar) },              -- herdr toggle_sidebar
        { key = "q", action = act.DetachDomain "CurrentPaneDomain" },                 -- herdr detach
        { key = "e", action = act.ReloadConfiguration },                              -- herdr reload_config
        { key = "z", action = act.TogglePaneZoomState },                              -- bonus: zoom pane
        { key = "s", action = act.PaneSelect },                                       -- bonus: tmux-ish pane picker
        -- workspaces ≈ Herdr sessions
        { key = "n", action = act.SwitchToWorkspace },                                -- new session
        { key = "l", action = act.ShowLauncherArgs { flags = "FUZZY|WORKSPACES" } },  -- pick session
        { key = "[", action = act.SwitchWorkspaceRelative(-1) },
        { key = "]", action = act.SwitchWorkspaceRelative(1) },
        { key = "Escape", action = act.PopKeyTable },
    },
    resize = {
        { key = "LeftArrow",  action = act.AdjustPaneSize { "Left", 3 } },
        { key = "DownArrow",  action = act.AdjustPaneSize { "Down", 3 } },
        { key = "UpArrow",    action = act.AdjustPaneSize { "Up", 3 } },
        { key = "RightArrow", action = act.AdjustPaneSize { "Right", 3 } },
        { key = "Escape", action = act.PopKeyTable },
        { key = "q", action = act.PopKeyTable },
        { key = "Enter", action = act.PopKeyTable },
    },
}

-- ▸ Keys — Herdr chords (direct) + Ghostty text remaps + leader ───────────────
-- The Option+Shift set is Herdr's own chord table, now owned by WezTerm.
-- ("OPT" and "ALT" are the same physical key on macOS; OPT|SHIFT used here.)
config.keys = {
    -- herdr focus_pane_*
    { key = "LeftArrow",  mods = "OPT|SHIFT", action = act.ActivatePaneDirection "Left" },
    { key = "DownArrow",  mods = "OPT|SHIFT", action = act.ActivatePaneDirection "Down" },
    { key = "UpArrow",    mods = "OPT|SHIFT", action = act.ActivatePaneDirection "Up" },
    { key = "RightArrow", mods = "OPT|SHIFT", action = act.ActivatePaneDirection "Right" },
    -- herdr split_vertical / split_horizontal (WezTerm SplitVertical = top/bottom,
    -- matching Herdr/tmux naming; verified in SplitVertical docs)
    { key = "d", mods = "OPT|SHIFT", action = act.SplitVertical { domain = "CurrentPaneDomain" } },
    { key = "c", mods = "OPT|SHIFT", action = act.SplitHorizontal { domain = "CurrentPaneDomain" } },
    -- herdr close_pane / resize_mode / new_tab / prev+next_tab / close_tab
    { key = "x", mods = "OPT|SHIFT", action = act.CloseCurrentPane { confirm = false } },
    { key = "r", mods = "OPT|SHIFT", action = act.ActivateKeyTable { name = "resize", replace_current = true } },
    { key = "t", mods = "OPT|SHIFT", action = act.SpawnTab "CurrentPaneDomain" },
    { key = ",", mods = "OPT|SHIFT", action = act.ActivateTabRelative(-1) },
    { key = ".", mods = "OPT|SHIFT", action = act.ActivateTabRelative(1) },
    { key = "w", mods = "OPT|SHIFT", action = act.CloseCurrentTab { confirm = false } },
    -- herdr toggle_sidebar / detach / reload_config
    { key = "b", mods = "OPT|SHIFT", action = wezterm.action_callback(toggle_sidebar) },
    { key = "q", mods = "OPT|SHIFT", action = act.DetachDomain "CurrentPaneDomain" },
    { key = "e", mods = "OPT|SHIFT", action = act.ReloadConfiguration },
    -- herdr remote_image_paste (option+shift+v): CONCEDED — no equivalent.
    -- herdr prefix: ctrl+space → leader table (Herdr's prefix; macOS input-
    -- source shortcut must stay off/remapped, same as Herdr required today)
    { key = "Space", mods = "CTRL", action = act.ActivateKeyTable { name = "herdr", one_shot = true, timeout_milliseconds = 1500 } },
    -- ghostty text-level remaps (1:1 mirror; delete if Karabiner covers them)
    { key = "Backspace", mods = "ALT", action = act.SendString("\x1b\x7f") }, -- alt+backspace → ESC DEL
    { key = "]", mods = "ALT", action = act.SendString("~") },
    { key = "'", mods = "ALT", action = act.SendString("@") },
}

-- ▸ Notifications / updates ───────────────────────────────────────────────────
config.notification_handling = "SuppressFromFocusedWindow" -- OSC 9/777 toasts
config.check_for_updates = false -- nightly users update manually

-- ▸ SSH domains — unchanged ───────────────────────────────────────────────────
local ssh_domains = {}
for _, domain in ipairs(wezterm.default_ssh_domains()) do
    if domain.name ~= "SSHMUX:router" and domain.name ~= "SSHMUX:nas" then
        table.insert(ssh_domains, domain)
    end
end
config.ssh_domains = ssh_domains

-- ▸ Workspace / status — unchanged ────────────────────────────────────────────
config.default_workspace = "main"
wezterm.on("update-right-status", function(window, pane)
    record_focus(window, pane)
    local workspace = window:active_workspace()
    local domain = pane:get_domain_name()
    window:set_right_status(workspace .. "  ·  " .. domain)
end)

-- ▸ Optional extras (commented; enable deliberately) ─────────────────────────
-- [[
-- Full modern terminfo: install with
--   curl -o /tmp/wezterm.terminfo https://raw.githubusercontent.com/wezterm/wezterm/main/termwiz/data/wezterm.terminfo
--   tic -x -o ~/.terminfo /tmp/wezterm.terminfo
-- then uncomment:  config.term = "wezterm"
-- ]]
-- [[
-- Nightly-only: extend behind the notch in fullscreen (M4 MacBook).
-- config.macos_fullscreen_extend_behind_notch = true
-- ]]
-- [[
-- Close without a prompt (ghostty-style):
-- config.window_close_confirmation = "NeverPrompt"
-- ]]

return config
