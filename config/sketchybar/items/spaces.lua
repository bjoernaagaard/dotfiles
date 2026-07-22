local colors = require("colors")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

local workspace_names = get_workspaces()
local focused_workspace = get_current_workspace()
local spaces = {}

local function shell_quote(value)
    return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function app_icon_line(apps)
    if type(apps) ~= "table" or #apps == 0 then
        return "No windows"
    end

    local icons = {}
    for _, app in ipairs(apps) do
        local app_name = app["app-name"]
        table.insert(icons, app_icons[app_name] or app_icons.default)
    end
    return table.concat(icons, "  ")
end

local function set_focused_workspace(workspace_name)
    focused_workspace = workspace_name
    for _, entry in ipairs(spaces) do
        local selected = entry.workspace == focused_workspace
        entry.item:set({
            icon = {
                color = selected and colors.white or colors.grey
            },
            background = {
                drawing = true,
                color = selected and settings.items.colors.selected or colors.transparent,
                border_width = 0
            }
        })
    end
end

local function refresh_workspace_apps()
    for _, entry in ipairs(spaces) do
        local current_entry = entry
        sbar.exec("aerospace list-windows --workspace " .. shell_quote(current_entry.workspace) ..
                      " --format '%{app-name}' --json",
                  function(apps)
            current_entry.popup:set({
                label = {
                    string = app_icon_line(apps)
                }
            })
        end)
    end
end

for index, workspace_name in ipairs(workspace_names) do
    local selected = workspace_name == focused_workspace
    local space = sbar.add("item", "space." .. index, {
        position = "left",
        width = 24,
        padding_left = 1,
        padding_right = 1,
        icon = {
            align = "center",
            font = {
                family = settings.font.numbers,
                style = settings.font.style_map["Semibold"],
                size = 12.0
            },
            string = workspace_name,
            color = selected and colors.white or colors.grey,
            padding_left = 0,
            padding_right = 0
        },
        label = {
            drawing = false
        },
        background = {
            drawing = true,
            height = 20,
            corner_radius = settings.items.corner_radius,
            color = selected and settings.items.colors.selected or colors.transparent,
            border_width = 0
        },
        popup = {
            align = "center"
        }
    })

    local popup = sbar.add("item", "space." .. index .. ".apps", {
        position = "popup." .. space.name,
        icon = {
            string = workspace_name,
            color = colors.grey
        },
        label = {
            string = "No windows",
            font = settings.icons,
            color = colors.white,
            padding_right = 10
        },
        padding_left = 8,
        padding_right = 8
    })

    local entry = {
        workspace = workspace_name,
        item = space,
        popup = popup
    }
    table.insert(spaces, entry)

    space:subscribe("mouse.clicked", function(env)
        if env.BUTTON == "other" then
            space:set({
                popup = {
                    drawing = "toggle"
                }
            })
        else
            sbar.exec("aerospace workspace " .. shell_quote(entry.workspace))
        end
    end)

    space:subscribe("mouse.exited.global", function()
        space:set({
            popup = {
                drawing = false
            }
        })
    end)
end

local workspace_observer = sbar.add("item", "workspace.observer", {
    drawing = false,
    updates = true
})

workspace_observer:subscribe("aerospace_workspace_change", function(env)
    set_focused_workspace(env.FOCUSED_WORKSPACE)
    refresh_workspace_apps()
end)

workspace_observer:subscribe({"aerospace_focus_change", "space_windows_change"}, function()
    refresh_workspace_apps()
end)

set_focused_workspace(focused_workspace)
refresh_workspace_apps()
