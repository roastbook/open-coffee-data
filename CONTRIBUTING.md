# Contributing

Thank you for helping. Roastbook Open Coffee is only as good as its sources, so every change needs one.

## Ways to help

- **Correct or add a place**: open the [add or correct a place](https://github.com/Roastbook/open-coffee-data/issues/new?template=correct-place.yml) form, or edit `datasets/coffee-places/<country>/<city>.json` in a pull request.
- **Report a closed place**: use the [closed place](https://github.com/Roastbook/open-coffee-data/issues/new?template=closed-place.yml) form. Closed places are never deleted; they get `status: closed` and `closed_on`.
- **Propose a source**: use the [propose a source](https://github.com/Roastbook/open-coffee-data/issues/new?template=propose-source.yml) form. New sources are reviewed by a maintainer, who checks the licence and terms.
- **Propose a schema change**: in [open-coffee-schema](https://github.com/Roastbook/open-coffee-schema/issues/new/choose).

## Owners: claim your place

If you run a café or roastery, you can claim its record:

1. Open the “Add or correct a place” issue and tick “I own or run this place”.
2. Prove it in one of two ways: send the issue from an email address on the place's website domain (or mention such an address and reply from it when we write), or link the issue from your website or Instagram bio for a few days.
3. Tell us what to change. Facts you submit are recorded with `method: owner_submitted` and the source `owner-submission`.

Owners may also submit their own photos. Photos must be yours and licensed CC BY 4.0; add them under `assets/coffee-places/` with a row in that folder's `LICENSE.md`, or attach them to the issue and say so.

To keep our crawler away from your site, see https://data.roastbook.coffee/bot/.

## Rules for data

- **Cite a source for every fact.** Each record has `sources[]`; a value that comes from somewhere else gets a `field_provenance` entry with its own sources. Every `source_id` must be on the allow-list in `datasets/sources.json`.
- **Facts only.** Never copy sentences or photos from a website or Instagram. Descriptions are written in our own words from the stored facts.
- **No Google Maps, no OpenStreetMap, no closed guides.** Do not use Google Maps or Places data (we may only store a `google_place_id` for verification), OpenStreetMap data (share-alike), or the lists of extract.coffee, European Coffee Trip, roasters.app, Caffe Atlas or review sites. Ratings from other services are stored only as links in `external_ratings`.
- **Unknown stays absent.** `false` means “confirmed not offered”; if you do not know, leave the field out.
- **Ids are permanent.** New places get `cp-` plus 10 random characters from `0123456789abcdefghjkmnpqrstvwxyz`. Never reuse, rename or delete an id. A duplicate keeps its record with `merged_into` pointing to the surviving id.
- **Images** need `licence`, `author` and `source_url`, and an open licence (CC0, CC BY, CC BY-SA). Files under `assets/` need a row in the folder's `LICENSE.md`.
- **No personal data.** Operators only when they are companies or other legal entities.

The checks behind these rules are listed in [docs/validation.md](docs/validation.md).

## Pull requests

```sh
pnpm install
scripts/validate.sh
scripts/build.sh     # optional: preview in dist/
```

If the README stats change, run `node scripts/readme-stats.mjs` and commit the result. Keep one city per pull request where you can. Changes to `datasets/sources.json`, `scripts/`, `.github/`, `schema-version.txt` and `agent/` always need a maintainer's review.

## Developer Certificate of Origin

All contributions must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Sign off each commit with `git commit -s`, which adds a line like this:

```text
Signed-off-by: Your Name <you@example.com>
```

By signing off, you certify that you wrote the contribution or otherwise have the right to submit it under the licence of the files you change: CC BY 4.0 for data and docs, Apache-2.0 for code, and the stated per-file licence for images.

## Code of conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Report problems to conduct@roastbook.coffee.
