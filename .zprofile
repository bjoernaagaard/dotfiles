# ~/.zprofile — runs once per login shell
# >>> dory cli >>>
# dory:restore-no-trailing-newline
DORY_CLI_BIN="/Users/bsa/.dory/bin"
case ":$PATH:" in
  *":$DORY_CLI_BIN:"*) ;;
  *) export PATH="$DORY_CLI_BIN:$PATH" ;;
esac
# <<< dory cli <<<
