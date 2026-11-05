## What changes

<!-- Places added or corrected, or what the code change does. Link the issue if there is one. -->

## Sources

<!-- For data changes: the pages or datasets each new value comes from. -->

## Checklist

- [ ] `scripts/validate.sh` passes locally (schema, ids, sources, deny-list, images, opening hours, README stats).
- [ ] Every new or changed value cites a source on the allow-list (`datasets/sources.json`), in `sources[]` or `field_provenance`.
- [ ] No text or photos were copied from websites or Instagram; no Google Maps, OpenStreetMap or closed-guide data was used.
- [ ] No id was deleted or reused; duplicates are kept with `merged_into`, closed places with `status: closed`.
- [ ] Every image has `licence`, `author` and `source_url`, and files under `assets/` have a row in the folder's `LICENSE.md`.
- [ ] README stats are regenerated (`node scripts/readme-stats.mjs`) if counts changed.
- [ ] Every commit is signed off (`git commit -s`) under the [DCO](https://developercertificate.org/).
