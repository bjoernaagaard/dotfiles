# zsh setup

The installer sets up zsh with Prezto, the starship prompt, and a set of command line tools on macOS or Linux. You can run it again at any time to update everything.

## How to install

Clone the repository and run the installer from the clone.

```sh
git clone <repository url> ~/zsh-setup
~/zsh-setup/install.sh
exec zsh
```

The installer may ask for your password twice, first when it installs zsh, git, or curl with the system package manager, and second when it makes zsh your login shell.

## What the installer does

The installer runs these steps in order, and it skips any step that is already done.

```text
install.sh
  install zsh, git, and curl if they are missing    (Homebrew, apt, dnf, pacman, zypper, or apk)
  install mise if it is missing                     (into ~/.local/bin)
  mise use -g starship fzf zoxide fd eza bat ripgrep
  clone or update Prezto                            (into ~/.zprezto)
  copy the files in home/ to your home folder
  write completion files                            (into ~/.local/share/zsh/site-functions)
  make zsh your login shell
```

[mise](https://mise.jdx.dev) installs and updates the command line tools, so you don't need root access for them. To update the tools later, run `mise upgrade`.

## Files

The installer copies each file in `home/` to the same path in your home folder.

```text
home/
├── .zshenv                    # PATH and environment for every zsh
├── .zprofile                  # fixes PATH order in macOS login shells
├── .zshrc                     # Prezto, key bindings, tools, aliases
├── .zpreztorc                 # which Prezto modules load
└── .config/
    ├── starship.toml          # prompt
    ├── bat/config             # bat color theme
    └── ripgrep/config         # rg searches hidden files, but skips .git
```

If a file already exists and differs from the new one, the installer moves the old file to `~/.zsh-setup-backup/<date and time>/` before it copies the new one.

To keep your own settings for one computer, put them in `~/.zshrc.local` or `~/.zshenv.local`. The config loads both files if they exist, and the installer never changes them.

## What you get in the shell

The prompt shows the folder, the git branch and status, the language versions for the project, how long a slow command took, and the exit code of a failed command.

Prezto adds completion, syntax highlighting, and suggestions from your history. Up and Down search your history for lines that contain what you already typed.

| Command | What it does |
| --- | --- |
| `ll`, `la`, `lt` | List files with eza, with `la` showing hidden files and `lt` showing a tree |
| `lc`, `lk`, `lu`, `lr`, `lm` | List by change time, size, or access time, list recursively, or page the list |
| `cat` | Shows a file with bat, with syntax colors |
| `cd` | Jumps to a folder you visited before when you give part of its name (zoxide) |
| `..`, `...`, `c` | Go up one or two folders, or clear the screen |
| `pwd` | Prints the folder and copies it to the clipboard |
| `refresh-completions` | Rebuilds the completion cache after you install a new tool |
| Ctrl+R, Ctrl+T, Alt+C | Search history, insert a file path, or change to a folder with fzf |

The `ll` family of commands shows file icons, which need a [Nerd Font](https://www.nerdfonts.com) in your terminal. Without a Nerd Font, the icons show as empty boxes.

## How to undo

First, copy the files you want back from `~/.zsh-setup-backup/`. Second, delete `~/.zprezto` if you don't want Prezto. Third, run `chsh -s /bin/bash` if you want bash as your login shell again.
