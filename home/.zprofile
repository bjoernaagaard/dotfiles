# Login shells only. macOS's path_helper in /etc/zprofile moves the folders from ~/.zshenv to the end of PATH.
path=($user_path $path)
