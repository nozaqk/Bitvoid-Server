Name:           bitvoid-server
Version:        %{version}
Release:        1%{?dist}
Summary:        Cross-platform local-first BitVoid Server and native Desktop Dashboard
License:        Proprietary
URL:            https://github.com/nozaqk/Bitvoid-Server

%description
BitVoid Server provides the headless Node.js application service with SQLite persistence,
protected local IPC administration, and the native Qt 6 desktop administration dashboard.
User data under /var/lib/bitvoid-server is preserved across upgrades and uninstalls.

%install
mkdir -p %{buildroot}/opt/bitvoid-server
mkdir -p %{buildroot}/usr/lib/systemd/system
cp -a %{_sourcedir}/stage-linux/. %{buildroot}/opt/bitvoid-server/
cp %{_sourcedir}/bitvoid-server.service %{buildroot}/usr/lib/systemd/system/bitvoid-server.service

%files
/opt/bitvoid-server
/usr/lib/systemd/system/bitvoid-server.service

%post
if ! getent group bitvoid >/dev/null 2>&1; then
  groupadd --system bitvoid
fi
if ! getent group bitvoid-admin >/dev/null 2>&1; then
  groupadd --system bitvoid-admin
fi
if ! id -u bitvoid >/dev/null 2>&1; then
  useradd --system --gid bitvoid --home-dir /var/lib/bitvoid-server --shell /sbin/nologin bitvoid
fi
mkdir -p /var/lib/bitvoid-server /etc/bitvoid-server
chown bitvoid:bitvoid-admin /var/lib/bitvoid-server
chmod 0710 /var/lib/bitvoid-server
if [ -f /var/lib/bitvoid-server/first-run-enrollment.txt ]; then
  chown bitvoid:bitvoid-admin /var/lib/bitvoid-server/first-run-enrollment.txt
  chmod 0640 /var/lib/bitvoid-server/first-run-enrollment.txt
fi
if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ] && id "${SUDO_USER}" >/dev/null 2>&1; then
  usermod -a -G bitvoid-admin "${SUDO_USER}"
fi
if [ ! -f /etc/bitvoid-server/server.env ]; then
  SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  printf 'BITVOID_TOKEN_SECRET=%s\nBITVOID_HOST=0.0.0.0\nBITVOID_PORT=8787\nBITVOID_DATA_DIR=/var/lib/bitvoid-server\n' "$SECRET" > /etc/bitvoid-server/server.env
fi
chown root:bitvoid /etc/bitvoid-server/server.env
chmod 0640 /etc/bitvoid-server/server.env
systemctl daemon-reload >/dev/null 2>&1 || true
systemctl enable bitvoid-server.service >/dev/null 2>&1 || true
systemctl restart bitvoid-server.service >/dev/null 2>&1 || true
%preun
if [ "$1" -eq 0 ]; then
  systemctl stop bitvoid-server.service >/dev/null 2>&1 || true
  systemctl disable bitvoid-server.service >/dev/null 2>&1 || true
fi
