#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.1.0}"
STAGE_DIR="${2:-dist/stage-linux}"
OUT_DIR="${3:-dist}"

APPDIR="$(mktemp -d)/BitVoidServer.AppDir"
trap 'rm -rf "$(dirname "$APPDIR")"' EXIT

mkdir -p "$APPDIR/usr/bin" "$APPDIR/opt/bitvoid-server"
cp -a "$STAGE_DIR/." "$APPDIR/opt/bitvoid-server/"

cat > "$APPDIR/AppRun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(dirname "$(readlink -f "${0}")")"
# Never write persistent SQLite/media data inside the read-only AppImage mount!
export BITVOID_USE_OS_DATA_DIR=true
export BITVOID_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/bitvoid-server"
mkdir -p "$BITVOID_DATA_DIR"
exec "$HERE/opt/bitvoid-server/desktop/bitvoid-server-desktop" "$@"
EOF
chmod 0755 "$APPDIR/AppRun"

cat > "$APPDIR/bitvoid-server.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=AirMesh Server
Exec=AppRun
Icon=bitvoid-server
Categories=Network;System;
EOF

# Minimal placeholder SVG icon for AppImage metadata
cat > "$APPDIR/bitvoid-server.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#0d1117"/>
  <circle cx="64" cy="64" r="34" fill="none" stroke="#38bdf8" stroke-width="10"/>
  <circle cx="64" cy="64" r="12" fill="#3fb950"/>
</svg>
EOF

mkdir -p "$OUT_DIR"
if command -v appimagetool >/dev/null 2>&1; then
  ARCH=x86_64 appimagetool "$APPDIR" "${OUT_DIR}/AirMesh-Server-${VERSION}-x86_64.AppImage"
  echo "Built ${OUT_DIR}/AirMesh-Server-${VERSION}-x86_64.AppImage"
else
  echo "appimagetool not found in PATH; install appimagetool (run inside Linux release runner)." >&2
  exit 1
fi
