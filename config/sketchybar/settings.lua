local colors = require("colors")
local icons = require("icons")

return {
    paddings = 3,
    group_paddings = 5,
    modes = {
        main = {
            icon = icons.rebel,
            color = colors.rainbow[1]
        },
        service = {
            icon = icons.nuke,
            color = 0xffff9e64
        }
    },
    bar = {
        height = 28,
        padding = {
            x = 8,
            y = 0
        },
        background = colors.bar.bg
    },
    items = {
        height = 22,
        gap = 5,
        padding = {
            right = 16,
            left = 12,
            top = 0,
            bottom = 0
        },
        default_color = function(workspace)
            return colors.white
        end,
        highlight_color = function(workspace)
            return colors.white
        end,
        colors = {
            background = colors.transparent,
            selected = 0x405b6074
        },
        corner_radius = 6
    },

    icons = "sketchybar-app-font:Regular:16.0", -- alternatively available: NerdFont

    font = {
        text = "SF Pro",    -- Used for text
        numbers = "SF Pro", -- Used for numbers
        style_map = {
            ["Regular"] = "Regular",
            ["Semibold"] = "Semibold",
            ["Bold"] = "Bold",
            ["Heavy"] = "Heavy",
            ["Black"] = "Black"
        }
    }
}
