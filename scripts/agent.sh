#!/usr/bin/env bash
# Data agent: discovers coffee places, verifies facts on primary pages and proposes changes as a pull request.
# Options: --city <slug> --limit N --dry-run --no-pr --stages a,b   (docs/agent.md)
# Env: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, SOURCING_BUDGET_USD, SOURCING_RUN_BUDGET_USD, GH_TOKEN, BRAVE_SEARCH_API_KEY (optional)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../agent"
command -v bun >/dev/null 2>&1 || { echo "error: Bun is required (https://bun.sh)." >&2; exit 1; }
[ -d node_modules ] || bun install --frozen-lockfile
exec bun src/cli.ts "$@"
