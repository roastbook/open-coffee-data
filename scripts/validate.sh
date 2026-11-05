#!/usr/bin/env bash
# All repository checks. Same behaviour locally and in CI (ci.yml).
# Env:
#   OPEN_COFFEE_SCHEMA_DIR  use a local schemas/ folder instead of the pinned release (development before a tag exists)
#   BASE_REF                ref to compare ids against (default origin/main; skipped with a notice when missing)
#   DATASETS_DIR            test override only
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
ensure_deps

version="$(tr -d '[:space:]' < schema-version.txt)"
families=(common coffee-places brew-methods equipment)

if [ -n "${OPEN_COFFEE_SCHEMA_DIR:-}" ]; then
  SCHEMA_DIR="$(cd "$OPEN_COFFEE_SCHEMA_DIR" && pwd)"
  echo "::notice::Using local schemas from $SCHEMA_DIR instead of the v$version release"
else
  SCHEMA_DIR="$ROOT/.cache/schemas/v$version"
  for family in "${families[@]}"; do
    target="$SCHEMA_DIR/$family/$family.schema.v$version.json"
    [ -s "$target" ] && continue
    mkdir -p "$(dirname "$target")"
    url="https://raw.githubusercontent.com/Roastbook/open-coffee-schema/v$version/schemas/$family/$family.schema.v$version.json"
    if ! curl -fsSL --retry 3 -o "$target.tmp" "$url"; then
      rm -f "$target.tmp"
      echo "::error::Could not fetch $url (is v$version tagged? set OPEN_COFFEE_SCHEMA_DIR for local development)"
      exit 1
    fi
    mv "$target.tmp" "$target"
  done
fi
export SCHEMA_DIR

rm -f .ci/report.json
status=0
echo "== Dataset checks (schema v$version)"
bun scripts/check.mjs || status=1
echo "== README stats"
if [ -n "${DATASETS_DIR:-}" ]; then
  echo "::notice::DATASETS_DIR is set; skipped the README stats check"
else
  bun scripts/readme-stats.mjs --check || status=1
fi
echo "== Checker unit tests"
bun test scripts/tests/ || status=1
exit "$status"
