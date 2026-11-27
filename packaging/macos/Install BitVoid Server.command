#!/usr/bin/env bash
set -euo pipefail

APP_PATH="/Applications/BitVoid Server.app"
PLIST_SOURCE="$APP_PATH/Contents/Resources/com.bitvoid.server.plist"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_DEST="$LAUNCH_AGENT_DIR/com.bitvoid.server.plist"
DOMAIN="gui/$(/usr/bin/id -u)"

if [[ ! -d "$APP_PATH" || ! -f "$PLIST_SOURCE" ]]; then
  echo "First drag BitVoid Server.app into /Applications, then run this installer again."
  read -r -p "Press Return to close..."
  exit 1
fi

mkdir -p "$LAUNCH_AGENT_DIR"
launchctl bootout "$DOMAIN" "$PLIST_DEST" >/dev/null 2>&1 || true
/usr/bin/install -m 600 "$PLIST_SOURCE" "$PLIST_DEST"
launchctl bootstrap "$DOMAIN" "$PLIST_DEST"
launchctl enable "$DOMAIN/com.bitvoid.server"
launchctl kickstart -k "$DOMAIN/com.bitvoid.server"

echo "BitVoid Server background service is installed for this macOS user."
echo "Your Server data and generated secret are stored in:"
echo "  $HOME/Library/Application Support/BitVoidServer"
open "$APP_PATH"
read -r -p "Press Return to close..."
