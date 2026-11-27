#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.1.0}"
APP_BUNDLE="${2:-dist/stage-macos/BitVoid Server.app}"
OUT_DIR="${3:-dist}"

if [ ! -d "$APP_BUNDLE" ]; then
  echo "macOS .app bundle not found at: $APP_BUNDLE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
DMG_STAGE="$(mktemp -d)"
trap 'rm -rf "$DMG_STAGE"' EXIT

cp -a "$APP_BUNDLE" "$DMG_STAGE/"
ln -s /Applications "$DMG_STAGE/Applications"
cp packaging/macos/INSTALL.txt "$DMG_STAGE/INSTALL.txt"
cp "packaging/macos/Install BitVoid Server.command" "$DMG_STAGE/Install BitVoid Server.command"
cp "packaging/macos/Uninstall BitVoid Server Service.command" "$DMG_STAGE/Uninstall BitVoid Server Service.command"
chmod 0755 "$DMG_STAGE/Install BitVoid Server.command" "$DMG_STAGE/Uninstall BitVoid Server Service.command"

DMG_OUT="${OUT_DIR}/BitVoid-Server-${VERSION}-macos.dmg"
rm -f "$DMG_OUT"

if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
  codesign --deep --force --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" "$DMG_STAGE/BitVoid Server.app"
fi

hdiutil create -volname "BitVoid Server ${VERSION}" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_OUT"

if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
  codesign --force --timestamp --sign "$MACOS_SIGN_IDENTITY" "$DMG_OUT"
fi

echo "Built ${DMG_OUT}"
