# Validation rules

`scripts/validate.sh` runs these checks locally and in CI (`cupping.yml`). It fails on any error and writes `.roast/report.json` for the Roast report. The rules live in `scripts/lib/check.mjs`; the deny-list in `scripts/config/denylist.json`. Both are under `scripts/`, which the Sourcing agent cannot edit: CI fails its pull requests outside `datasets/coffee-places/**`.

## Schema

- The schema version comes from `schema-version.txt`. The script downloads `https://raw.githubusercontent.com/Roastbook/open-coffee-schema/v<version>/schemas/<family>/<family>.schema.v<version>.json` for every family into `.cache/schemas/`. `OPEN_COFFEE_SCHEMA_DIR=<path to schemas/>` uses a local checkout instead (development before a tag exists).
- Every `datasets/**/*.json` is validated against the schema named in its `$schema` (Ajv, JSON Schema 2020-12, `ajv-formats`, strict mode, all errors). The `$schema` version must equal the pin, and `meta.schema_version`, when present, too.
- Files in `datasets/<family>/` must use the `<family>` schema.

## Ids

- Ids are unique within a family across all files.
- Ids are never deleted: every id in the dataset files at `BASE_REF` (default `origin/main`; CI sets the pull request base) must still exist. When the ref does not exist (first commit, shallow clone) the check is skipped with a warning.
- `merged_into` must point at an existing record of the same family, not at itself; pointing at a record that is itself merged gives a warning.
- Brew methods: `parent` must exist and parent chains must not loop. Equipment: `brew_methods` entries must be brew method ids. (`equipment_types` values are checked by the schema.)

## Deny-list

No URL anywhere in a record (links, image, prices, roasters, awards, references) may point at a deny-listed host: extract.coffee, European Coffee Trip, roasters.app, Caffe Atlas, Google Maps (including `maps.app.goo.gl`, `goo.gl`, `g.page` and Places API hosts), OpenStreetMap, Yelp, Tripadvisor, HappyCow and Foursquare app venue pages. Review sites (Yelp, Tripadvisor, HappyCow) are allowed only as links in `external_ratings[].url`, which never store rating values.

## Images

- Every `image` has `licence`, `author` and `source_url` (schema), and the licence must be CC0-1.0, PDM-1.0, CC-BY-x.0 or CC-BY-SA-x.0.
- Images are only linked: `image.url` points to the original file. The repository holds no image files.

## Coffee places only

- Files live at `datasets/coffee-places/<country>/<city>.json`; `meta.country_code` equals the folder in upper case, `meta.city` equals the file name, and `meta.schema_version` is required.
- `opening_hours` must parse with the [`opening_hours`](https://github.com/opening-hours/opening_hours.js) library (OpenStreetMap syntax, used as a format only). Its style hints are reported as warnings.

## README

The `<!-- stats:start -->` block in `README.md` must match `bun scripts/readme-stats.mjs` output.

## Unit tests

`bun test scripts/tests/` tests the checker against fixtures built from the schema repository's valid examples, plus the artifact flattening and the Explorer's filter logic.
