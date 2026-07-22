local settings = require("settings")

-- Equivalent to the --bar domain
sbar.bar({
    topmost = "window",
    height = settings.bar.height,
    color = settings.bar.background,
    border_width = 0,
    border_color = 0x00000000,
    blur_radius = 30,
    padding_right = settings.bar.padding.x,
    padding_left = settings.bar.padding.x,
    -- padding_top = settings.bar.padding.y,
    -- padding_bottom = settings.bar.padding.y,
    sticky = true,
    position = "top",
    shadow = false
})
