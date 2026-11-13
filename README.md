# dotfiles

The installer sets up zsh with Prezto, the starship prompt, and a set of command line tools on macOS or Linux. You can run it again at any time to update everything.

## How to install

Clone the repository and run the installer from the clone.

```sh
git clone https://github.com/bjoernaagaard/dotfiles.git ~/dotfiles
~/dotfiles/install.sh
exec zsh
```

The installer may ask for your password twice, first when it installs zsh, git, or curl with the system package manager, and second when it makes zsh your login shell.

To see what the installer finds on your computer and what it would change, run it with `--dry-run` first. A dry run changes nothing.

```sh
~/dotfiles/install.sh --dry-run
```

## What the installer does

The installer runs these steps in order, and it skips any step that is already done.

```text
install.sh
  check the current setup and list what it finds
  pick out the settings to keep from the old zsh files
  install zsh, git, and curl if they are missing    (Homebrew, apt, dnf, pacman, zypper, or apk)
  install or update mise                            (into ~/.local/bin)
  mise use -g starship fzf zoxide fd eza bat ripgrep
  clone or update Prezto                            (into ~/.zprezto)
  copy the files in home/ to your home folder, and back up the old ones
  write completion files                            (into ~/.local/share/zsh/site-functions)
  make zsh your login shell
  start zsh once and report any errors
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

To keep your own settings for one computer, put them in `~/.zshrc.local`, `~/.zshenv.local`, or `~/.zprofile.local`. The config loads these files if they exist, and the installer only adds to them.

## Moving from an existing setup

You can run the installer on a computer that already has a zsh setup, e.g., Oh My Zsh, Powerlevel10k, an older copy of this config, or a `.zshrc` you wrote yourself. The installer sorts each old file into one of these groups:

| Old file | What the installer does |
| --- | --- |
| Same as the new file | Leaves it alone |
| An older version of this config | Replaces it |
| An older version of this config with your changes | Replaces it, and copies the lines you added into the `.local` file |
| Any other file | Replaces it, and copies the settings that still work into the `.local` file |

From other files, the installer copies your exports, aliases, functions, and tool setup such as nvm or conda. It skips the lines that load another framework or prompt, and the lines that the new config already runs.

```diff
 # old ~/.zshrc                                   # new ~/.zshrc.local
-source $ZSH/oh-my-zsh.sh
-ZSH_THEME="powerlevel10k/powerlevel10k"
-autoload -U compinit && compinit
+export JAVA_HOME=/usr/lib/jvm/default
+alias k=kubectl
+mkcd() { mkdir -p "$1" && cd "$1" }
```

If you're moving from bash, the installer also copies the exports and aliases you added to `~/.bashrc`, `~/.bash_profile`, `~/.bash_aliases`, and `~/.profile`. It skips the lines that came with the system.

The installer also handles these cases:

- If `ZDOTDIR` moves your zsh files to another folder, the installer reads the old files from that folder.
- If `~/.zprezto` is a fork, has local changes, or isn't a Git clone, the installer moves it to the backup and clones Prezto again.
- If an old alias has the same name as a new one, your old alias wins, and the installer tells you which aliases it kept.
- If the copied lines aren't valid zsh, the installer turns them into comments, so zsh still starts.

The installer never deletes another framework's folder, such as `~/.oh-my-zsh`. When it finds one, it tells you that you can delete the folder yourself.

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

First, copy the files you want back from `~/.zsh-setup-backup/`, and delete the `.local` files that the installer wrote. Second, delete `~/.zprezto` if you don't want Prezto. Third, run `chsh -s /bin/bash` if you want bash as your login shell again.
