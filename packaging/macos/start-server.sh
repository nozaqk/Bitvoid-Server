#!/usr/bin/env bash
set -euo pipefail
umask 077

RESOURCES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$RESOURCES_DIR/runtime/bin/node"
SERVER_ENTRY="$RESOURCES_DIR/server/src/server.js"
DATA_DIR="$HOME/Library/Application Support/BitVoidServer"
ENV_FILE="$DATA_DIR/server.env"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Bundled Node.js runtime is missing: $NODE_BIN" >&2
  exit 1
fi
if [[ ! -f "$SERVER_ENTRY" ]]; then
  echo "BitVoid Server entry point is missing: $SERVER_ENTRY" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN_SECRET="$(/usr/bin/openssl rand -base64 48 | /usr/bin/tr -d '\r\n')"
  if [[ ${#TOKEN_SECRET} -lt 32 ]]; then
    echo "Could not generate a sufficiently strong Server token secret." >&2
    exit 1
  fi

  cat > "$ENV_FILE" <<ENVEOF
BITVOID_TOKEN_SECRET=$TOKEN_SECRET
BITVOID_USE_OS_DATA_DIR=true
BITVOID_DATA_DIR="$DATA_DIR"
BITVOID_HOST=0.0.0.0
BITVOID_PORT=8787
BITVOID_DISPLAY_NAME="BitVoid Local Server"
BITVOID_DEPLOYMENT_MODE=self-hosted
BITVOID_NETWORK_MODE=lan
ENVEOF
fi

chmod 600 "$ENV_FILE"
exec "$NODE_BIN" --env-file="$ENV_FILE" "$SERVER_ENTRY"
