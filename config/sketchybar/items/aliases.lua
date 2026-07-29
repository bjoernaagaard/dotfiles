local colors = require("colors")

sbar.add("bracket", "status.group", {"widgets.cpu", "widgets.wifi.padding", "widgets.volume", "clock"}, {
    background = {
        drawing = true,
        color = colors.group,
        border_color = colors.group_border,
        border_width = 1,
        corner_radius = 7,
        height = 24
    },
    padding_left = 4,
    padding_right = 4
})
