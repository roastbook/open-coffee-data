#!/usr/bin/env bash
# All repository checks. Same behaviour locally and in CI (ci.yml).
# Env:
#   OPEN_COFFEE_SCHEMA_DIR  use a local schemas/ folder instead of the released schemas named in $schema (development before a tag exists)
#   BASE_REF                ref to compare ids against (default origin/main; skipped with a notice when missing)
#   DATASETS_DIR            test override only
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
ensure_deps

families=(common coffee-places brew-methods equipment)
# Schema versions in use, from the $schema URLs; check.mjs fails when one family mixes versions.
mapfile -t versions < <(grep -rhoE --include='*.json' '"\$schema": *"https://schema\.roastbook\.coffee/[^"]+\.schema\.v[0-9]+\.[0-9]+\.[0-9]+\.json"' "${DATASETS_DIR:-datasets}" \
  | sed -E 's/.*\.schema\.v([0-9]+\.[0-9]+\.[0-9]+)\.json"$/\1/' | sort -u)

if [ -n "${OPEN_COFFEE_SCHEMA_DIR:-}" ]; then
  SCHEMA_DIR="$(cd "$OPEN_COFFEE_SCHEMA_DIR" && pwd)"
  echo "::notice::Using local schemas from $SCHEMA_DIR instead of the released schemas (${versions[*]})"
else
  SCHEMA_DIR="$ROOT/.cache/schemas"
  for version in "${versions[@]}"; do
    for family in "${families[@]}"; do
      target="$SCHEMA_DIR/v$version/$family/$family.schema.v$version.json"
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
  done
fi
export SCHEMA_DIR

rm -f .ci/report.json
status=0
echo "== Dataset checks (schema ${versions[*]:-none})"
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
