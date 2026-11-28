#!/usr/bin/env bash
set -euo pipefail

PLIST_DEST="$HOME/Library/LaunchAgents/com.bitvoid.server.plist"
DOMAIN="gui/$(/usr/bin/id -u)"

launchctl bootout "$DOMAIN" "$PLIST_DEST" >/dev/null 2>&1 || true
rm -f "$PLIST_DEST"

echo "AirMesh Server background service has been removed from this macOS user."
echo "The application and all Server data have been preserved."
echo "To remove data manually, review:"
echo "  $HOME/Library/Application Support/BitVoidServer"
read -r -p "Press Return to close..."
