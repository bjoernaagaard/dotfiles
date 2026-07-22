local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

local popup_width = 240
local active_interface = nil
local active_hardware_port = nil
local refresh_pending = false
local refresh_requested = false
local refresh_callbacks = {}
local details_visible = false
local update_details

-- Keep the established SketchyBar item names for external queries. This item
-- represents the default-route network, not Wi-Fi specifically.
local network = sbar.add("item", "widgets.wifi.padding", {
    position = "right",
    update_freq = 5,
    padding_left = 4,
    padding_right = 4,
    icon = {
        string = icons.network.disconnected,
        color = colors.red,
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

local connection_name = sbar.add("item", "widgets.network.connection", {
    position = "popup." .. network.name,
    width = popup_width,
    icon = {
        font = {
            style = settings.font.style_map["Bold"]
        },
        string = icons.network.router
    },
    label = {
        font = {
            size = 13,
            style = settings.font.style_map["Semibold"]
        },
        max_chars = 28,
        string = "No default network"
    },
    background = {
        drawing = true,
        height = 2,
        color = colors.grey,
        y_offset = -13
    }
})

local network_up = sbar.add("item", "widgets.wifi1", {
    position = "popup." .. network.name,
    width = popup_width,
    icon = {
        align = "left",
        width = popup_width / 2,
        color = colors.grey,
        string = icons.network.upload
    },
    label = {
        align = "right",
        width = popup_width / 2,
        color = colors.grey,
        string = "000 Bps",
        font = {
            family = settings.font.numbers,
            style = settings.font.style_map["Semibold"],
            size = 12.0
        }
    }
})

local network_down = sbar.add("item", "widgets.wifi2", {
    position = "popup." .. network.name,
    width = popup_width,
    icon = {
        align = "left",
        width = popup_width / 2,
        color = colors.grey,
        string = icons.network.download
    },
    label = {
        align = "right",
        width = popup_width / 2,
        color = colors.grey,
        string = "000 Bps",
        font = {
            family = settings.font.numbers,
            style = settings.font.style_map["Semibold"],
            size = 12.0
        }
    }
})

local hostname = sbar.add("item", "widgets.network.hostname", {
    position = "popup." .. network.name,
    icon = {
        align = "left",
        string = "Hostname:",
        width = popup_width / 2
    },
    label = {
        max_chars = 20,
        string = "Unavailable",
        width = popup_width / 2,
        align = "right"
    }
})

local ip = sbar.add("item", "widgets.network.ip", {
    position = "popup." .. network.name,
    icon = {
        align = "left",
        string = "IP:",
        width = popup_width / 2
    },
    label = {
        string = "Unavailable",
        width = popup_width / 2,
        align = "right"
    }
})

local mask = sbar.add("item", "widgets.network.mask", {
    position = "popup." .. network.name,
    icon = {
        align = "left",
        string = "Subnet mask:",
        width = popup_width / 2
    },
    label = {
        string = "Unavailable",
        width = popup_width / 2,
        align = "right"
    }
})

local router = sbar.add("item", "widgets.network.router", {
    position = "popup." .. network.name,
    icon = {
        align = "left",
        string = "Router:",
        width = popup_width / 2
    },
    label = {
        string = "Unavailable",
        width = popup_width / 2,
        align = "right"
    }
})

network:subscribe("network_update", function(env)
    local up_color = (env.upload == "000 Bps") and colors.grey or colors.red
    local down_color = (env.download == "000 Bps") and colors.grey or colors.blue
    network_up:set({
        icon = {color = up_color},
        label = {string = env.upload, color = up_color}
    })
    network_down:set({
        icon = {color = down_color},
        label = {string = env.download, color = down_color}
    })
end)

local function hardware_icon(hardware_port, connected)
    if not connected then
        return icons.network.disconnected
    end

    local normalized_port = string.lower(hardware_port or "")
    if string.find(normalized_port, "wi%-fi") then
        return icons.network.wifi
    elseif string.find(normalized_port, "ethernet") then
        return icons.network.ethernet
    end
    return icons.network.generic
end

local function reset_throughput()
    network_up:set({
        icon = {color = colors.grey},
        label = {string = "000 Bps", color = colors.grey}
    })
    network_down:set({
        icon = {color = colors.grey},
        label = {string = "000 Bps", color = colors.grey}
    })
end

local function restart_provider(interface)
    local provider_command = "killall network_load >/dev/null 2>&1"
    if interface then
        provider_command = provider_command ..
                               "; \"$CONFIG_DIR/helpers/event_providers/network_load/bin/network_load\" " ..
                               interface .. " network_update 2.0 >/dev/null 2>&1 & provider_pid=$!; " ..
                               "while kill -0 \"$provider_pid\" 2>/dev/null; do " ..
                               "[ \"$(/bin/ps -p \"$provider_pid\" -o ucomm= | /usr/bin/tr -d \" \")\" = network_load ] && break; " ..
                               "sleep 0.01; done"
    end

    -- lockf serializes overlapping reloads. Without it, several reload shells
    -- can all finish killall before any of them starts its replacement.
    sbar.exec("/usr/bin/lockf -k /tmp/sketchybar-network-provider-$UID.lock " ..
                  "/bin/sh -c '" .. provider_command .. "'")

    if not interface then
        reset_throughput()
    end
end

local detect_network_command = [[
interface=$(/sbin/route -n get default 2>/dev/null | /usr/bin/awk '/interface:/{print $2; exit}')
if [ -z "$interface" ]; then
  printf '\t\t\t'
  exit 0
fi
hardware_port=$(/usr/sbin/networksetup -listallhardwareports 2>/dev/null | /usr/bin/awk -v interface="$interface" '
  /^Hardware Port: / { port = substr($0, 16) }
  /^Device: / && $2 == interface { print port; exit }
')
address=$(/usr/sbin/ipconfig getifaddr "$interface" 2>/dev/null)
status=$(/sbin/ifconfig "$interface" 2>/dev/null | /usr/bin/awk '/status:/{print $2; exit}')
printf '%s\t%s\t%s\t%s' "$interface" "$hardware_port" "$address" "$status"
]]

local function apply_network_state(interface, hardware_port, address, status)
    if not (interface and interface:match("^[%w._:-]+$")) then
        interface = nil
        hardware_port = nil
        address = nil
        status = nil
    end

    local interface_changed = interface ~= active_interface
    active_interface = interface
    active_hardware_port = hardware_port

    if interface_changed then
        restart_provider(active_interface)
        hostname:set({label = "Unavailable"})
        ip:set({label = "Unavailable"})
        mask:set({label = "Unavailable"})
        router:set({label = "Unavailable"})
    end

    local connected = active_interface ~= nil and address ~= "" and status == "active"
    local icon = hardware_icon(active_hardware_port, connected)
    network:set({
        icon = {
            string = icon,
            color = connected and colors.white or colors.red
        }
    })
    connection_name:set({icon = {string = icon}})

    if active_interface then
        connection_name:set({
            label = (active_hardware_port ~= "" and active_hardware_port or "Network") ..
                " (" .. active_interface .. ")"
        })
    else
        connection_name:set({label = "No default network"})
    end

    if interface_changed and details_visible and update_details then
        update_details()
    end
end

local function refresh_network(after_refresh)
    if after_refresh then
        table.insert(refresh_callbacks, after_refresh)
    end
    if refresh_pending then
        refresh_requested = true
        return
    end

    refresh_pending = true
    sbar.exec(detect_network_command, function(result)
        local interface, hardware_port, address, status =
            result:match("^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\r\n]*)")
        apply_network_state(interface, hardware_port, address, status)
        refresh_pending = false

        local callbacks = refresh_callbacks
        refresh_callbacks = {}
        for _, callback in ipairs(callbacks) do
            callback()
        end

        if refresh_requested then
            refresh_requested = false
            refresh_network()
        end
    end)
end

network:subscribe({"routine", "wifi_change", "system_woke"}, function()
    refresh_network()
end)

update_details = function()
    local interface = active_interface
    local hardware_port = active_hardware_port
    if not interface then
        connection_name:set({label = "No default network"})
        hostname:set({label = "Unavailable"})
        ip:set({label = "Unavailable"})
        mask:set({label = "Unavailable"})
        router:set({label = "Unavailable"})
        return
    end

    sbar.exec("networksetup -getcomputername", function(result)
        hostname:set({label = result ~= "" and result or "Unavailable"})
    end)
    sbar.exec("ipconfig getifaddr " .. interface .. " 2>/dev/null", function(result)
        if interface == active_interface then
            ip:set({label = result ~= "" and result or "Unavailable"})
        end
    end)
    sbar.exec("ipconfig getoption " .. interface .. " subnet_mask 2>/dev/null", function(result)
        if interface == active_interface then
            mask:set({label = result ~= "" and result or "Unavailable"})
        end
    end)
    sbar.exec("ipconfig getoption " .. interface .. " router 2>/dev/null", function(result)
        if interface == active_interface then
            router:set({label = result ~= "" and result or "Unavailable"})
        end
    end)

    local normalized_port = string.lower(hardware_port or "")
    if string.find(normalized_port, "wi%-fi") then
        sbar.exec("ipconfig getsummary " .. interface ..
                      " 2>/dev/null | awk -F ' SSID : ' '/ SSID : / {print $2; exit}'",
                  function(result)
            if interface == active_interface then
                local title = result ~= "" and result or hardware_port
                connection_name:set({label = title .. " (" .. interface .. ")"})
            end
        end)
    end
end

local function hide_details()
    details_visible = false
    network:set({popup = {drawing = false}})
end

network:subscribe("mouse.clicked", function()
    local should_draw = network:query().popup.drawing == "off"
    if should_draw then
        details_visible = true
        network:set({popup = {drawing = true}})
        refresh_network(update_details)
    else
        hide_details()
    end
end)

network:subscribe("mouse.exited.global", hide_details)

local function copy_label_to_clipboard(env)
    local label = sbar.query(env.NAME).label.value
    local quoted_label = "'" .. label:gsub("'", "'\\''") .. "'"
    sbar.exec("printf '%s' " .. quoted_label .. " | pbcopy")
    sbar.set(env.NAME, {label = {string = icons.clipboard, align = "center"}})
    sbar.delay(1, function()
        sbar.set(env.NAME, {label = {string = label, align = "right"}})
    end)
end

connection_name:subscribe("mouse.clicked", copy_label_to_clipboard)
hostname:subscribe("mouse.clicked", copy_label_to_clipboard)
ip:subscribe("mouse.clicked", copy_label_to_clipboard)
mask:subscribe("mouse.clicked", copy_label_to_clipboard)
router:subscribe("mouse.clicked", copy_label_to_clipboard)

refresh_network()
