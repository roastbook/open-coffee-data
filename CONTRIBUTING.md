# Contributing

Thank you for helping. Roastbook Open Coffee is only as good as its facts, so every change needs a primary source we can check.

## Ways to help

- **Correct or add a place**: open an [issue](https://github.com/Roastbook/open-coffee-data/issues/new) with the place, the change and a primary-source link, or edit `datasets/coffee-places/<country>/<city>.json` in a pull request.
- **Report a closed place**: open an [issue](https://github.com/Roastbook/open-coffee-data/issues/new) with evidence (for example a closure notice). Closed places are never deleted; they get `status: closed` and `closed_on`.
- **Propose a schema change**: in [open-coffee-schema](https://github.com/Roastbook/open-coffee-schema/issues/new).

## Owners: claim your place

If you run a café or roastery, you can claim its record:

1. Open an [issue](https://github.com/Roastbook/open-coffee-data/issues/new) and say that you own or run the place.
2. Prove it in one of two ways: send the issue from an email address on the place's website domain (or mention such an address and reply from it when we write), or link the issue from your website or Instagram bio for a few days.
3. Tell us what to change.

Owners may also suggest a photo: link the original file, published under an open licence (CC0, CC BY or CC BY-SA), with its author. We link to it; we do not host image files.


## Rules for data

- **Check every fact on a primary source** (the place's own website or an open dataset) and link it in your issue or pull request.
- **Facts only.** Never copy sentences or photos from a website or Instagram. Descriptions are written in our own words from the stored facts.
- **No Google Maps, no OpenStreetMap, no closed guides.** Do not use Google Maps or Places data (we may only store a `google_place_id` for verification), OpenStreetMap data (share-alike), or the lists of extract.coffee, European Coffee Trip, roasters.app, Caffe Atlas or review sites. Ratings from other services are stored only as links in `external_ratings`.
- **Unknown stays absent.** `false` means “confirmed not offered”; if you do not know, leave the field out.
- **Only confirmed places.** A place is in the dataset only when its own website confirms it. New places get `cp-` plus 10 random characters from `0123456789abcdefghjkmnpqrstvwxyz`; never reuse or rename an id. A place that closes keeps its record with `status: closed`; a duplicate or a place that can no longer be confirmed is removed.
- **Images** need `licence`, `author` and `source_url`, and an open licence (CC0, CC BY, CC BY-SA). Link the original file; never add image files to the repository.
- **No personal data.** Operators only when they are companies or other legal entities.
- **No versions in data files.** `meta` holds only `licence`, `country_code`, `city` and `city_name`. The schema version is the `$schema` URL (changed only by the schema bump pull request); the dataset version is the release tag.

The checks behind these rules are listed in [docs/validation.md](docs/validation.md).

## Pull requests

```sh
bun install
scripts/validate.sh
scripts/build.sh     # optional: preview in dist/
```

If the README stats change, run `bun scripts/readme-stats.mjs` and commit the result. Keep one city per pull request where you can. Changes to `scripts/`, `.github/` and `agent/` always need a maintainer's review.

## Developer Certificate of Origin

All contributions must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Sign off each commit with `git commit -s`, which adds a line like this:

```text
Signed-off-by: Your Name <you@example.com>
```

By signing off, you certify that you wrote the contribution or otherwise have the right to submit it under the licence of the files you change: [CDLA-Permissive-2.0](LICENSE-DATA) for data in `datasets/`, [MIT](LICENSE) for everything else.

## Code of conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Report problems to hello@roastbook.coffee.
