local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

-- The provider is detached from the reload shell so reloading cannot leave a
-- waiting shell behind. Expected killall errors are intentionally silenced.
sbar.exec("/usr/bin/lockf -k /tmp/sketchybar-cpu-provider-$UID.lock /bin/sh -c '" ..
              "killall cpu_load >/dev/null 2>&1; " ..
              "\"$CONFIG_DIR/helpers/event_providers/cpu_load/bin/cpu_load\" cpu_update 2.0 " ..
              ">/dev/null 2>&1 & provider_pid=$!; " ..
              "while kill -0 \"$provider_pid\" 2>/dev/null; do " ..
              "[ \"$(/bin/ps -p \"$provider_pid\" -o ucomm= | /usr/bin/tr -d \" \")\" = cpu_load ] && break; " ..
              "sleep 0.01; done'")

local cpu = sbar.add("item", "widgets.cpu", {
    position = "right",
    padding_left = 4,
    padding_right = 4,
    icon = {
        string = icons.cpu,
        color = colors.white,
        padding_left = 2,
        padding_right = 2
    },
    label = {
        drawing = false
    },
    popup = {
        align = "center"
    }
})

local cpu_title = sbar.add("item", "widgets.cpu.details", {
    position = "popup." .. cpu.name,
    width = 150,
    icon = {
        string = "CPU",
        color = colors.grey,
        align = "left",
        width = 75
    },
    label = {
        string = "0%",
        color = colors.white,
        align = "right",
        width = 75,
        font = {
            family = settings.font.numbers,
            style = settings.font.style_map["Semibold"],
            size = 13.0
        }
    }
})

local cpu_graph = sbar.add("graph", "widgets.cpu.graph", 150, {
    position = "popup." .. cpu.name,
    graph = {
        color = colors.blue,
        fill_color = colors.with_alpha(colors.blue, 0.18),
        line_width = 1.5
    },
    background = {
        drawing = true,
        height = 40,
        color = colors.selection,
        border_width = 0,
        corner_radius = settings.items.corner_radius
    },
    icon = {
        drawing = false
    },
    label = {
        drawing = false
    }
})

cpu:subscribe("cpu_update", function(env)
    local load = tonumber(env.total_load) or 0
    cpu_graph:push({load / 100})

    local color = colors.blue
    if load >= 80 then
        color = colors.red
    elseif load >= 60 then
        color = colors.orange
    elseif load >= 30 then
        color = colors.yellow
    end

    cpu:set({icon = {color = load >= 80 and colors.red or colors.white}})
    cpu_title:set({label = env.total_load .. "%"})
    cpu_graph:set({
        graph = {
            color = color,
            fill_color = colors.with_alpha(color, 0.18)
        }
    })
end)

local function hide_details()
    cpu:set({popup = {drawing = false}})
end

cpu:subscribe("mouse.clicked", function(env)
    if env.BUTTON == "other" then
        sbar.exec("open -a 'Activity Monitor'")
    else
        cpu:set({popup = {drawing = "toggle"}})
    end
end)

cpu:subscribe("mouse.exited.global", hide_details)
