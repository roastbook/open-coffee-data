# Validation rules

`scripts/validate.sh` runs these checks locally and in CI (`ci.yml`). It fails on any error and writes `.ci/report.json` for the CI summary. The rules live in `scripts/lib/check.mjs`; the deny-list in `scripts/config/denylist.json`. Both are under `scripts/`, which the Sourcing agent cannot edit: CI fails its pull requests outside `datasets/coffee-places/**`.

## Schema

- The schema versions come from the `$schema` URLs of the dataset files. All files of a family must name the same version. For every version in use the script downloads `https://raw.githubusercontent.com/Roastbook/open-coffee-schema/v<version>/schemas/<family>/<family>.schema.v<version>.json` for every family into `.cache/schemas/v<version>/`. `OPEN_COFFEE_SCHEMA_DIR=<path to schemas/>` uses a local checkout instead (development before a tag exists).
- Every `datasets/**/*.json` is validated against the schema named in its `$schema` (Ajv, JSON Schema 2020-12, `ajv-formats`, strict mode, all errors). `meta` holds only `licence` (plus the city fields below); it carries no version.
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

- Files live at `datasets/coffee-places/<country>/<city>.json`; `meta.country_code` equals the folder in upper case, and `meta.city` equals the file name.
- `opening_hours` must parse with the [`opening_hours`](https://github.com/opening-hours/opening_hours.js) library (OpenStreetMap syntax, used as a format only). Its style hints are reported as warnings.

## Data lint

`agent/src/lint.ts` checks values that pass the schema but are still wrong. The data agent applies the same rules before it writes. Run it alone with `bun agent/src/lint.ts`; `--strict` also fails on warnings, and `--fix` applies the safe repairs below and rewrites the files.

Errors (CI fails):

- `website-platform`: `links.website` is a directory, delivery, booking, review or social page (Gelbe Seiten, Lieferando, speisekartenweb, Facebook …), not the place's own site.
- `contact-data`: an email address or phone number outside `links`.
- `duplicate`: two live records with nearly the same name within 40 m (or the same name within 60 m). Mark one with `merged_into`.
- `status-open-unverified`: `status: open` without `last_verified_at`.
- `open-sunday`, `payment`, `serving`: contradictions (`open_sunday` against `opening_hours`, cash only and card payment both true, pour-over true but filter false).
- `operator`: not a legal entity; `price`: an implausible cappuccino price; `postcode`: wrong format for the country.
- `tier-evidence`: tier A or B without `roasts_own_beans` or `roasters_served`.

Warnings: names with a legal form, SEO tails or a bare street name; street strings that are not "street number"; tier `unknown` for a name that looks like a non-coffee business; descriptions on places that are not tier A or B; open places not verified for half a year; more than 3 places sharing one website; images not from an open image repository.

`--fix` only removes doubtful values or derives values from stored fields; it never adds a fact. A platform page used as a website is removed together with every value read from it. Duplicates become tombstones (`merged_into`), so no id disappears.

## README

The `<!-- stats:start -->` block in `README.md` must match `bun scripts/readme-stats.mjs` output.

## Unit tests

`bun test scripts/tests/` tests the checker against fixtures built from the schema repository's valid examples, plus the artifact flattening and the Explorer's filter logic.
