# ~/.zprofile — runs once per login shell
#
# Dory CLI
# --------
# The markers # >>> dory cli >>>, # <<< dory cli <<<, and the marker
# line that starts with # dory: are functional. The dory CLI manages
# this block. Do not edit it.

# >>> dory cli >>>
# dory:restore-no-trailing-newline
DORY_CLI_BIN="/Users/bsa/.dory/bin"
case ":$PATH:" in
  *":$DORY_CLI_BIN:"*) ;;
  *) export PATH="$DORY_CLI_BIN:$PATH" ;;
esac
# <<< dory cli <<<