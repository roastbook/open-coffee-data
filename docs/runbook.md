# Runbook

## Adding a city

1. Make sure the city is next in the Sourcing queue (Berlin, Hamburg, Munich, Cologne, Frankfurt, Düsseldorf, Leipzig, Stuttgart, then all German cities over 100,000 inhabitants, then Austria and Switzerland), or that a contributor is preparing it.
2. Create `datasets/coffee-places/<country>/<city>.json`: `<country>` is the lower-case ISO code (`de`), `<city>` a lower-case ASCII slug (`koeln`, `frankfurt-am-main`). Set `$schema` to the coffee-places schema URL the other files use, and fill `meta`: `licence: CDLA-Permissive-2.0`, `country_code` (upper case), `city` (the slug), `city_name` (local name). There is no version field; the schema version is the `$schema` URL and the dataset version is the release tag.
3. Add places through the Sourcing agent (`data-agent.yml`, `workflow_dispatch` with the city) or by hand. Check every fact on a primary source.
4. Run `scripts/validate.sh`, then `bun scripts/readme-stats.mjs` to refresh the README numbers, and `scripts/build.sh` to check the Explorer (the city appears in the city filter automatically; artifacts are generated per city).
5. Open a pull request. Add the city to `docs/pilots/` if it gets a report, and to the repository topics if it is a major city (`scripts/repo-metadata.sh` in Roastbook/workflows).

## Releasing a dataset version

1. On `main`, with CI green and the README stats current, run the Release workflow (`release.yml`). It creates the next tag `YYYY.MM.DD.N` (N starts at 1 for the day) and the GitHub Release with the changelog (`cliff.toml`). No dataset file changes: the version lives only in the tag.
2. The tag push runs `deploy.yml`. The build reads the version from `DATASET_VERSION` or `git describe --tags --match '[0-9]*'` (builds between releases show `<tag>-<commits>-g<sha>`, builds without a tag show `unreleased`).
3. Check https://data.roastbook.coffee/ (footer shows the new version) and `/artifacts/index.json` (`dataset_version`).

## Rolling back a deploy

Pages serves whatever the last successful `deploy.yml` run uploaded. There is no `gh-pages` branch.

- **Bad data or site on main**: revert the offending commit with a pull request (`git revert <sha>`). Never delete ids to “undo” a merge: if the revert removes ids, keep them as tombstones instead (`status: closed` or `merged_into`), otherwise validation fails. Merging the revert redeploys.
- **Urgent, before a revert can merge**: in Actions, open the last good `Deploy` run and choose “Re-run all jobs”. It rebuilds that commit and deploys it. The next push to `main` deploys again, so land the revert soon.
- **A release tag points at bad data**: do not move or delete published tags. Release a new tag (`…N+1`) with the fix and mark the bad GitHub Release as such in its notes.
- **Broken basemap**: the map tiles come from OpenFreeMap. If they are down, the table, detail pages and downloads still work; nothing to roll back.


## Repository settings (manual)

- Social preview: upload the 1280×640 Roastbook-branded image in Settings → General → Social preview.

## Shared Roastbook UI

The shared implementation lives in [Roastbook/ui](https://github.com/roastbook/ui).
The site imports `@roastbook/ui/astro/Layout.astro` and `@roastbook/ui/sites`.
Its dependency pins a public Git commit, so installing the UI needs no GitHub
Packages token. Update the dependency and `bun.lock` together, then run the
repository validation and build scripts. Layout, logo and theme changes belong
in the UI repository.
