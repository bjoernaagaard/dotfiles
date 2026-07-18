# Dotfiles

## Mise bootstrap

The private repository needs a small seed on a new Mac. Insert the registered
YubiKey and recover its resident GitHub SSH credential. This creates only an
OpenSSH key-handle file; the private key remains inside the YubiKey:

```zsh
mkdir -p -m 700 "$HOME/.ssh" "$HOME/.config/mise"
cd "$HOME/.ssh"
ssh-keygen -K
mv id_ed25519_sk "$HOME/.ssh/id_ed25519_sk_github_usb_a"
mv id_ed25519_sk.pub "$HOME/.ssh/id_ed25519_sk_github_usb_a.pub"

printf '%s\n' \
  'Host github.com' \
  '  AddKeysToAgent no' \
  '  IdentitiesOnly yes' \
  '  IdentityFile ~/.ssh/id_ed25519_sk_github_usb_a' \
  > "$HOME/.ssh/config.local"

printf '%s\n' \
  '[bootstrap.repos]' \
  '"~/.dotfiles" = { url = "git@github.com:dotbsa/dotfiles.git", ref = "main" }' \
  > "$HOME/.config/mise/config.toml"

mise bootstrap --yes
```

After the repository is cloned, mise manages shared `~/.ssh/config` routing.
`~/.ssh/config.local` and the YubiKey handle files remain machine-specific and
are not committed.
