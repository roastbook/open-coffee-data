#!/usr/bin/env bash
# Checks the links in the datasets and the Markdown files with lychee.
#   scripts/link-check.sh         pull-request mode: report broken links as warnings, exit 0
#   scripts/link-check.sh --full  weekly mode: fail on broken links
# Social sites (Instagram, Facebook, …) that answer 403/429 to bots are always warnings.
# Needs lychee on PATH (CI installs the release binary) or Docker (lycheeverse/lychee image).
# No package dependencies, so CI can run it without installing the workspace (Bun only writes the report).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
full=false
[ "${1:-}" = "--full" ] && full=true
LYCHEE_IMAGE="lycheeverse/lychee:0.24.2"
SOCIAL='(^|\.)(instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com)$'

mapfile -t inputs < <(git ls-files --cached --others --exclude-standard -- '*.md' 'datasets/**/*.json' 2>/dev/null || find . -name '*.md' -not -path './node_modules/*')
[ "${#inputs[@]}" -gt 0 ] || { echo "no inputs"; exit 0; }
mkdir -p .roast
out=.roast/lychee.json

args=(--config lychee.toml --format json --output "$out" --no-progress)
[ -n "${GITHUB_TOKEN:-}" ] && args+=(--github-token "$GITHUB_TOKEN")
set +e
if command -v lychee >/dev/null 2>&1; then
  lychee "${args[@]}" "${inputs[@]}"
else
  docker run --rm -e GITHUB_TOKEN -v "$ROOT:/input" -w /input "$LYCHEE_IMAGE" "${args[@]}" "${inputs[@]}"
fi
code=$?
set -e
if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
  echo "::error::lychee failed to run (exit $code)"
  exit "$code"
fi

# Split failures into hard failures and social-site warnings. lychee's JSON lists failures per input file.
failures="$(jq -r --arg social "$SOCIAL" '
  (.error_map // .fail_map // {}) | to_entries[] | .key as $file | .value[] |
  (.url | capture("^https?://(?<host>[^/:]+)").host // "") as $host |
  (.status.code // 0) as $code |
  [ (if ($host | test($social)) and ($code == 403 or $code == 429 or $code == 999) then "social" else "broken" end),
    $file, .url, (.status.text // (.status | tostring)) ] | @tsv' "$out")"

broken=0
warnings=()
while IFS=$'\t' read -r kind file url status; do
  [ -z "${kind:-}" ] && continue
  msg="$file: $url ($status)"
  if [ "$kind" = "broken" ] && $full; then
    echo "::error::$msg"; broken=$((broken + 1))
  else
    echo "::warning::$msg"
  fi
  warnings+=("link: $msg")
done <<< "$failures"

total="$(jq -r '.total // 0' "$out")"
if command -v bun >/dev/null 2>&1; then
  printf '%s\n' "${warnings[@]+"${warnings[@]}"}" | bun -e "
import { mergeReport } from './scripts/lib/report.mjs';
const lines = (await Bun.stdin.text()).split('\n').filter(Boolean);
mergeReport(process.cwd(), { links: { checked: $total, broken: $broken, full: $full }, warnings: lines });
"
fi
echo "links checked: $total, problems: ${#warnings[@]}, failing: $broken"
[ "$broken" -eq 0 ]
