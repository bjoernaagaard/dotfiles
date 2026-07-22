local settings = require("settings")
local colors = require("colors")

local function clock_string()
    return (os.date("%a %I:%M %p"):gsub(" 0", " "))
end

local clock = sbar.add("item", "clock", {
    position = "right",
    update_freq = 30,
    padding_left = 6,
    padding_right = 2,
    icon = {
        drawing = false
    },
    label = {
        string = clock_string(),
        color = colors.white,
        font = {
            family = settings.font.text,
            style = settings.font.style_map["Semibold"],
            size = 13.0
        }
    }
})

clock:subscribe({"forced", "routine", "system_woke"}, function()
    clock:set({label = clock_string()})
end)

-- The bar stays date-free; clicking opens the full system calendar.
clock:subscribe("mouse.clicked", function()
    sbar.exec("open -a Calendar")
end)
