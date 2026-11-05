# Sourced by the scripts in scripts/. Sets ROOT and installs workspace dependencies when missing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ensure_deps() {
  command -v bun >/dev/null 2>&1 || { echo "error: Bun $(cat .bun-version) is required (https://bun.sh)." >&2; exit 1; }
  if [ ! -d node_modules/ajv ] || [ ! -d site/node_modules/astro ]; then
    if ! bun install --frozen-lockfile; then
      echo "error: bun install failed. @roastbook/open-coffee-ui comes from GitHub Packages: export NPM_GITHUB_TOKEN=\"\$(gh auth token)\" (scope read:packages). Before it is published, link the sibling checkout instead (docs/runbook.md#shared-ui-package)." >&2
      exit 1
    fi
  fi
}
