local home = os.getenv("HOME") or "/Users/" .. os.getenv("USER")
local config_dir = os.getenv("CONFIG_DIR") or home .. "/.config/sketchybar"

package.cpath = package.cpath .. ";" .. home .. "/.local/share/sketchybar_lua/?.so"
os.execute(string.format('(cd "%s/helpers/event_providers" && make)', config_dir))
