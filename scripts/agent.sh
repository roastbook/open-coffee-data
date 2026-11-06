#!/usr/bin/env bash
# Data agent: discovers coffee places, verifies facts on primary pages and proposes changes as a pull request.
# Options: --city <slug> --limit N --dry-run --no-pr --stages a,b   (docs/agent.md)
# Env: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, GH_TOKEN, RESEARCH_MODEL, BRAVE_SEARCH_API_KEY or SEARXNG_URL (optional)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../agent"
command -v bun >/dev/null 2>&1 || { echo "error: Bun is required (https://bun.sh)." >&2; exit 1; }
[ -d node_modules ] || bun install --frozen-lockfile
# Headless browser for JavaScript-only sites, kept in the project cache so it survives container restarts.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$(pwd)/../.cache/playwright}"
if ! ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-* >/dev/null 2>&1; then
  bunx playwright-core install chromium-headless-shell >&2 || echo "warning: headless browser not installed; JavaScript-only sites will not be rendered" >&2
fi
exec bun src/cli.ts "$@"
