#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.1.0}"
STAGE_DIR="${2:-dist/stage-linux}"
OUT_DIR="${3:-dist}"
ARCH="${4:-amd64}"

PKG_ROOT="$(mktemp -d)"
trap 'rm -rf "$PKG_ROOT"' EXIT

mkdir -p "$PKG_ROOT/DEBIAN"
mkdir -p "$PKG_ROOT/opt/bitvoid-server"
mkdir -p "$PKG_ROOT/lib/systemd/system"
mkdir -p "$PKG_ROOT/usr/share/applications"
mkdir -p "$PKG_ROOT/usr/local/bin"

cp -a "$STAGE_DIR/." "$PKG_ROOT/opt/bitvoid-server/"
cp packaging/linux/bitvoid-server.service "$PKG_ROOT/lib/systemd/system/bitvoid-server.service"

cat > "$PKG_ROOT/usr/local/bin/bitvoid-server-desktop" <<'EOF'
#!/usr/bin/env bash
exec /opt/bitvoid-server/desktop/bitvoid-server-desktop "$@"
EOF
chmod 0755 "$PKG_ROOT/usr/local/bin/bitvoid-server-desktop"

cat > "$PKG_ROOT/usr/local/bin/bitvoid-admin" <<'EOF'
#!/usr/bin/env bash
exec /opt/bitvoid-server/runtime/bin/node /opt/bitvoid-server/server/bin/bitvoid-admin.js "$@"
EOF
chmod 0755 "$PKG_ROOT/usr/local/bin/bitvoid-admin"

cat > "$PKG_ROOT/usr/share/applications/bitvoid-server.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=BitVoid Server Dashboard
Comment=Local-first BitVoid Server Administration Dashboard
Exec=/usr/local/bin/bitvoid-server-desktop
Terminal=false
Categories=Network;System;
EOF

cat > "$PKG_ROOT/DEBIAN/control" <<EOF
Package: bitvoid-server
Version: ${VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Maintainer: BitVoid <maintainers@bitvoid.local>
Description: Cross-platform local-first BitVoid Server and native Desktop Dashboard
 Includes the headless BitVoid Server systemd service, bundled Node.js runtime,
 protected local IPC administration interface, and native Qt 6 desktop dashboard.
EOF

cat > "$PKG_ROOT/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if ! id -u bitvoid >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/bitvoid-server --shell /usr/sbin/nologin bitvoid
fi

mkdir -p /var/lib/bitvoid-server /etc/bitvoid-server
chown -R bitvoid:bitvoid /var/lib/bitvoid-server
chmod 0700 /var/lib/bitvoid-server

if [ ! -f /etc/bitvoid-server/server.env ]; then
  SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  cat > /etc/bitvoid-server/server.env <<ENVEOF
BITVOID_TOKEN_SECRET=${SECRET}
BITVOID_HOST=0.0.0.0
BITVOID_PORT=8787
BITVOID_DISPLAY_NAME=BitVoid Local Server
BITVOID_DATA_DIR=/var/lib/bitvoid-server
BITVOID_DEPLOYMENT_MODE=self-hosted
BITVOID_NETWORK_MODE=lan
ENVEOF
  chown root:bitvoid /etc/bitvoid-server/server.env
  chmod 0640 /etc/bitvoid-server/server.env
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
  systemctl enable bitvoid-server.service || true
  systemctl restart bitvoid-server.service || true
fi
EOF
chmod 0755 "$PKG_ROOT/DEBIAN/postinst"

cat > "$PKG_ROOT/DEBIAN/prerm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "remove" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl stop bitvoid-server.service || true
  systemctl disable bitvoid-server.service || true
fi
# User data under /var/lib/bitvoid-server is intentionally preserved across upgrades and removals.
EOF
chmod 0755 "$PKG_ROOT/DEBIAN/prerm"

mkdir -p "$OUT_DIR"
dpkg-deb --build "$PKG_ROOT" "${OUT_DIR}/bitvoid-server_${VERSION}_${ARCH}.deb"
echo "Built ${OUT_DIR}/bitvoid-server_${VERSION}_${ARCH}.deb"
