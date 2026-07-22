local colors = require("colors")

-- This exact alias is present in `sketchybar --query default_menu_items`.
-- The current BetterDisplay menu item exposes a wide, visually blank alias surface, so
-- keep the native alias registered but use its app icon as the compact control.
-- Karabiner's temporary notification windows are intentionally not mirrored.
sbar.add("alias", "BetterDisplay,(1)", {
    position = "right",
    drawing = false,
    padding_left = 0,
    padding_right = 0,
    background = {
        drawing = false
    },
    alias = {
        color = colors.white,
        scale = 0.1,
        update_freq = 2
    }
})

local better_display = sbar.add("item", "betterdisplay", {
    position = "right",
    width = 22,
    padding_left = 4,
    padding_right = 4,
    icon = {
        drawing = false
    },
    label = {
        drawing = false
    },
    background = {
        drawing = true,
        height = 18,
        corner_radius = 4,
        border_width = 0,
        color = colors.transparent,
        image = {
            string = "app.BetterDisplay",
            scale = 0.55
        }
    }
})

better_display:subscribe("mouse.clicked", function()
    sbar.exec("open -a BetterDisplay")
end)
