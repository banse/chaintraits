#!/usr/bin/env bash
# desc: Serve the static Sworn mainnet candidate on loopback; no proxy or signing backend.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SWORN_PORT=8804
while (($#)); do
  case "$1" in
    --port) SWORN_PORT="${2:?Specify a port}"; shift 2 ;;
    --help) printf '%s\n' 'Usage: ./sworn-mainnet-site/start.sh [--port 8804]' 'Build first: cd sworn-mainnet-site/web && npm ci && npm run build' 'Serves dist on 127.0.0.1. Ethereum and IMD reads use browser connections.'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ "$SWORN_PORT" =~ ^[0-9]+$ ]] && ((SWORN_PORT > 0 && SWORN_PORT < 65536)) || { printf '%s\n' 'Port must be between 1 and 65535.' >&2; exit 2; }
[[ -f "$ROOT/dist/imd-deployment.json" ]] || { printf '%s\n' 'Missing export. Run npm run build inside web first.' >&2; exit 1; }
exec python3 -m http.server "$SWORN_PORT" --bind 127.0.0.1 --directory "$ROOT/dist"
