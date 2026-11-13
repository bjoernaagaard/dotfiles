# Login shells only.

# Settings for this computer only. The installer only adds to this file, and only when it keeps settings from an old setup.
[[ -r "${ZDOTDIR:-$HOME}/.zprofile.local" ]] && source "${ZDOTDIR:-$HOME}/.zprofile.local"

# macOS's path_helper in /etc/zprofile moves the folders from ~/.zshenv to the end of PATH, and so
# can tools in .zprofile.local. Put them first again.
path=($user_path $path)
