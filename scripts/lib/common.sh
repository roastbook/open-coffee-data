# Sourced by the scripts in scripts/. Sets ROOT and installs workspace dependencies when missing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# A writable Corepack cache for local shells where pnpm is a Corepack shim; CI installs pnpm directly.
[ -n "${COREPACK_HOME:-}" ] && [ -w "$COREPACK_HOME" ] || export COREPACK_HOME="$HOME/.cache/corepack"
pnpm_cmd() {
  if command -v pnpm >/dev/null 2>&1; then pnpm "$@"; else corepack pnpm "$@"; fi
}

ensure_deps() {
  if [ ! -d node_modules/ajv ] || [ ! -d site/node_modules/astro ]; then
    pnpm_cmd install --frozen-lockfile
  fi
}
