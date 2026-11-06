# shellcheck shell=bash
# Sourced by the scripts in scripts/. Sets ROOT and installs workspace dependencies when missing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ensure_deps() {
  command -v bun >/dev/null 2>&1 || { echo "error: Bun $(cat .bun-version) is required (https://bun.sh)." >&2; exit 1; }
  if [ ! -d node_modules/ajv ] || [ ! -d site/node_modules/astro ]; then
    if ! bun install --frozen-lockfile; then
      echo "error: bun install failed. Check network access and whether bun.lock matches package.json. The shared UI is pinned to a public Git commit." >&2
      exit 1
    fi
  fi
}
