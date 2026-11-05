# Runbook

## Adding a city

1. Make sure the city is next in the Sourcing queue (Berlin, Hamburg, Munich, Cologne, Frankfurt, Düsseldorf, Leipzig, Stuttgart, then all German cities over 100,000 inhabitants, then Austria and Switzerland), or that a contributor is preparing it.
2. Create `datasets/coffee-places/<country>/<city>.json`: `<country>` is the lower-case ISO code (`de`), `<city>` a lower-case ASCII slug (`koeln`, `frankfurt-am-main`). Fill `meta`: `version` (the next data tag), `generated_at`, `licence: CC-BY-4.0`, `attribution: Roastbook Open Coffee`, `schema_version` (equal to `schema-version.txt`), `country_code` (upper case), `city` (the slug), `city_name` (local name).
3. Add places through the Sourcing agent (`sourcing.yml`, `workflow_dispatch` with the city) or by hand. Every place needs `sources[]` from `datasets/sources.json`.
4. Run `scripts/validate.sh`, then `node scripts/readme-stats.mjs` to refresh the README numbers, and `scripts/build.sh` to check the Explorer (the city appears in the city filter automatically; artifacts are generated per city).
5. Open a pull request. Add the city to `docs/pilots/` if it gets a report, and to the repository topics if it is a major city (`scripts/repo-metadata.sh` in Roastbook/workflows).

## Releasing a dataset version

1. On `main`, with CI green, pick the tag `YYYY.MM.DD.N` (N starts at 1 for the day).
2. Set `meta.version` in every changed dataset file to that tag (the Sourcing agent and `bump-schema.yml` do this in their PRs), run `node scripts/readme-stats.mjs`, merge.
3. Tag and push: `git tag -s 2026.11.05.1 -m "Data 2026.11.05.1" && git push origin 2026.11.05.1`. `release.yml` creates the GitHub Release with the changelog (`cliff.toml`) and `serve.yml` deploys Pages.
4. Check https://data.roastbook.coffee/ (footer shows the new version) and `/artifacts/index.json`.

## Rolling back a deploy

Pages serves whatever the last successful `serve.yml` run uploaded. There is no `gh-pages` branch.

- **Bad data or site on main**: revert the offending commit with a pull request (`git revert <sha>`). Never delete ids to “undo” a merge: if the revert removes ids, keep them as tombstones instead (`status: closed` or `merged_into`), otherwise validation fails. Merging the revert redeploys.
- **Urgent, before a revert can merge**: in Actions, open the last good `Roastbook · 🫖 Serve (deploy)` run and choose “Re-run all jobs”. It rebuilds that commit and deploys it. The next push to `main` deploys again, so land the revert soon.
- **A release tag points at bad data**: do not move or delete published tags. Release a new tag (`…N+1`) with the fix and mark the bad GitHub Release as such in its notes.
- **Broken basemap**: the map tiles come from OpenFreeMap. If they are down, the table, detail pages and downloads still work; nothing to roll back.

## Repository settings (manual)

- Social preview: upload the 1280×640 Roastbook-branded image in Settings → General → Social preview.
- Branch protection: see [branch-protection.md](branch-protection.md) (a proposal; apply only after maintainer approval).
