local icons = require("icons")
local colors = require("colors")

local volume = sbar.add("item", "widgets.volume", {
    position = "right",
    padding_left = 4,
    padding_right = 4,
    icon = {
        string = icons.volume._33,
        color = colors.white,
        padding_left = 2,
        padding_right = 2
    },
    label = {
        drawing = false
    }
})

local function set_volume(level)
    local numeric_level, muted = tostring(level):match("^(%d+)%s+(%a+)")
    level = tonumber(numeric_level or level) or 0
    if muted == "true" then
        level = 0
    end
    local icon = icons.volume._0
    if level >= 67 then
        icon = icons.volume._100
    elseif level >= 34 then
        icon = icons.volume._66
    elseif level >= 11 then
        icon = icons.volume._33
    elseif level > 0 then
        icon = icons.volume._10
    end
    volume:set({icon = {string = icon}})
end

local function refresh_volume()
    sbar.exec("osascript -e 'set s to get volume settings' " ..
                  "-e 'return (output volume of s as text) & \" \" & (output muted of s as text)'",
              set_volume)
end

volume:subscribe("volume_change", refresh_volume)

volume:subscribe("mouse.clicked", function()
    sbar.exec("osascript -e 'set isMuted to output muted of (get volume settings)' " ..
                  "-e 'set volume output muted (not isMuted)'",
              refresh_volume)
end)

refresh_volume()
