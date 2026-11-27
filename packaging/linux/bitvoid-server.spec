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
if ! id -u bitvoid >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/bitvoid-server --shell /sbin/nologin bitvoid
fi
mkdir -p /var/lib/bitvoid-server /etc/bitvoid-server
chown -R bitvoid:bitvoid /var/lib/bitvoid-server
chmod 0700 /var/lib/bitvoid-server
if [ ! -f /etc/bitvoid-server/server.env ]; then
  SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  printf 'BITVOID_TOKEN_SECRET=%s\nBITVOID_HOST=0.0.0.0\nBITVOID_PORT=8787\nBITVOID_DATA_DIR=/var/lib/bitvoid-server\n' "$SECRET" > /etc/bitvoid-server/server.env
  chown root:bitvoid /etc/bitvoid-server/server.env
  chmod 0640 /etc/bitvoid-server/server.env
fi
systemctl daemon-reload >/dev/null 2>&1 || true

%preun
if [ "$1" -eq 0 ]; then
  systemctl stop bitvoid-server.service >/dev/null 2>&1 || true
  systemctl disable bitvoid-server.service >/dev/null 2>&1 || true
fi
