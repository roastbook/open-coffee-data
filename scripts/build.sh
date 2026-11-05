#!/usr/bin/env bash
# Builds the Pages artifact into dist/: Data Explorer, datasets/ verbatim, compiled
# artifacts/ and CNAME. Same behaviour locally and in CI (roast.yml).
# Env: DATASETS_DIR (test override only), BUILD_DATE (default: today, UTC).
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
ensure_deps

export DATASETS_DIR="$(cd "${DATASETS_DIR:-$ROOT/datasets}" && pwd)"
export ARTIFACTS_DIR="$ROOT/.cache/artifacts"
export BUILD_DATE="${BUILD_DATE:-$(date -u +%F)}"

echo "== Artifacts"
bun scripts/build-artifacts.mjs "$ARTIFACTS_DIR"

echo "== Data Explorer"
rm -rf dist
SITE_OUT_DIR="$ROOT/dist" bun run --cwd site build

echo "== Static files"
mkdir -p dist/artifacts
cp -R "$ARTIFACTS_DIR/." dist/artifacts/
cp -R "$DATASETS_DIR" dist/datasets
# The Roastbook mark (all rights reserved) comes from the shared UI package at build time.
cp "$(realpath site/node_modules/@roastbook/open-coffee-ui/assets/mark.svg)" dist/favicon.svg
echo "data.roastbook.coffee" > dist/CNAME

bytes="$(du -sb dist | cut -f1)"
count="$(find dist -type f | wc -l | tr -d ' ')"
bun -e "
import { mergeReport } from './scripts/lib/report.mjs';
mergeReport(process.cwd(), { build: { bytes: $bytes, files: $count }, url: 'https://data.roastbook.coffee/' });
"
echo "dist/: $count files, $bytes bytes"
