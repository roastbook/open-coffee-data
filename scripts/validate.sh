#!/usr/bin/env bash
# All repository checks. Same behaviour locally and in CI (ci.yml).
# Env:
#   OPEN_COFFEE_SCHEMA_DIR  use a local schemas/ folder instead of the released schemas named in $schema (development before a tag exists)
#   BASE_REF                ref to compare ids against (default origin/main; skipped with a notice when missing)
#   DATASETS_DIR            test override only
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
ensure_deps

# Schema versions in use, from the $schema URLs; check.mjs fails when one family mixes versions.
mapfile -t versions < <(grep -rhoE --include='*.json' '"\$schema": *"https://schema\.roastbook\.coffee/[^"]+\.schema\.v[0-9]+\.[0-9]+\.[0-9]+\.json"' "${DATASETS_DIR:-datasets}" \
  | sed -E 's/.*\.schema\.v([0-9]+\.[0-9]+\.[0-9]+)\.json"$/\1/' | sort -u)

if [ -n "${OPEN_COFFEE_SCHEMA_DIR:-}" ]; then
  SCHEMA_DIR="$(cd "$OPEN_COFFEE_SCHEMA_DIR" && pwd)"
  echo "::notice::Using local schemas from $SCHEMA_DIR instead of the released schemas (${versions[*]})"
else
  # Every release tag holds all earlier schema files too (published files never change), so the
  # newest version in use brings every family and version the datasets name.
  latest="$(printf '%s\n' "${versions[@]}" | sort -V | tail -1)"
  SCHEMA_DIR="$ROOT/.cache/schemas/v$latest"
  if [ -n "$latest" ] && [ ! -d "$SCHEMA_DIR" ]; then
    url="https://codeload.github.com/Roastbook/open-coffee-schema/tar.gz/refs/tags/v$latest"
    mkdir -p "$SCHEMA_DIR.tmp"
    if ! curl -fsSL --retry 3 "$url" | tar -xz -C "$SCHEMA_DIR.tmp" --strip-components=2 --wildcards '*/schemas/'; then
      rm -rf "$SCHEMA_DIR.tmp"
      echo "::error::Could not fetch the schemas of v$latest from $url (is v$latest tagged? set OPEN_COFFEE_SCHEMA_DIR for local development)"
      exit 1
    fi
    mv "$SCHEMA_DIR.tmp" "$SCHEMA_DIR"
  fi
fi
export SCHEMA_DIR

rm -f .ci/report.json
status=0
echo "== Dataset checks (schema ${versions[*]:-none})"
bun scripts/check.mjs || status=1
echo "== Data lint (agent/src/lint.ts: values that pass the schema but are wrong, e.g. directory pages as websites, contact data, duplicates)"
bun agent/src/lint.ts || status=1
echo "== README stats"
if [ -n "${DATASETS_DIR:-}" ]; then
  echo "::notice::DATASETS_DIR is set; skipped the README stats check"
else
  bun scripts/readme-stats.mjs --check || status=1
fi
echo "== Checker unit tests"
bun test scripts/tests/ || status=1
exit "$status"
