# Munich pilot, November 2026

The first city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`. The data is in [`datasets/coffee-places/de/munich.json`](../../datasets/coffee-places/de/munich.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset. Each record's values come from that website, the Overture record and code checks: a value proposed by the model is kept only if its quote occurs on the fetched page and the field's deterministic check passes, and the data linter runs before anything is written. Places that could not be confirmed are not in the repository; the agent keeps them in a local, uncommitted archive for later work.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 15 |
| Tier B (serves specialty) | 19 |
| none (not specialty: chains, restaurants, bakeries …) | 86 |
| unknown (confirmed, but no specialty evidence on its own site) | 270 |
| **Total** | **390**, all open |

Every place has a website (that is how it was confirmed), 96% have a street and postcode, and 60% have opening hours (82% of tier A/B).

## Result against the acceptance criteria

| Criterion | Target | Result | Met |
|---|---|---|---|
| Coverage of extract.coffee's still-open Munich cafés | ≥ 90% | 34 of 41 (82.9%) | no |
| Tier A/B places with complete core fields | ≥ 60 | 7 (5 A, 2 B) | no |
| Validation passes, nothing non-redistributable committed | yes | `scripts/validate.sh` against the released v0.3.0 schema: 0 errors; data lint: 0 errors | yes |

Both data targets are missed, and the coverage is lower than in the first version of this report (87.8%) on purpose: places that could not be confirmed on their own website are no longer in the file. The core fields that are most often missing for tier A/B places are filter coffee (24 of 34 unknown) and espresso (19 of 34 unknown): cafés rarely state them on their websites, and menus are often images (see "Next steps").

The SPEC's candidates CSV and its 59-place ground truth list were never provided, so there is no comparison against them.

## Corrections since the first publication

The first published file (1,076 records) had defects that an independent review and the new data linter found. All are fixed:

- **Wrong websites.** The site check accepted any name word, including district, street and month names, so a coffee chain's locations page became the website of neighbouring shops (for example a locations page matched "Mai Asia", "Naturkosmetik Schwabing" and three shops on Gärtnerplatz). The check now ignores district, street, city and generic words, and needs the whole name or every distinctive word. Records whose re-read website does not name them left the dataset.
- **Platform pages as websites** (Gelbe Seiten, Lieferando, speisekartenweb, gastroguide, Facebook) and every value read from them were removed; platform pages are never used.
- **Wrong tiers.** Places on a roaster's reference or stockist list (a bike shop, a beer hall, a restaurant) were tier B. Roaster lists are no longer used at all; a roaster counts only when the place's own website names it with a specialty claim, and tier A/B needs status open.
- **Evidence rules.** A quote that negates a value ("kein WLAN") no longer supports `true`; "Speisekarte" no longer counts as card payment, "Hotdog" not as dogs allowed, a supplier mention not as own roasting, a bare "250 g" not as selling beans, and "Barzahlung" not as cash only.
- **Other fixes:** Facebook share links, owners' names inside place names, an email address in a street, seasonal venues (Oktoberfest tents are not stored at all; only places open all year are), non-coffee businesses at discovery (75 excluded), 3 confirmed duplicates (Hochlandkaffee into Pachamama, Maxim Kaffee into Groove Coffee Club, and the operator name "Christoph Jünger Gastronomie" into cafe Clara).
- **Only confirmed places.** 697 of the 1,076 published records left the repository: 656 that had never been confirmed, 6 duplicate tombstones, and 35 whose website, read again, no longer confirms them (or that turned out to be duplicates). No dataset release had been tagged, so no released id was lost; the agent keeps them in an uncommitted local archive.

In numbers: 1,076 records before, 390 after: 379 kept (276 of them changed, 857 values in total), 11 new, 697 removed.

## Discovery

| Source | Count | Notes |
|---|---:|---|
| Overture places in coffee categories inside the city boundary | 1,024 | a coffee category as the main one, or as a side category of a food or drink place; 59 more were `permanently_closed`, 75 clearly non-coffee or seasonal |
| after merging Overture duplicates | 991 | |
| Web leads from a search-capable model, per district (25 districts) | 93 | names and own websites; leads only |
| Web-search seed files | 103 places, 110 websites | leads only |
| Wikidata cafés | 5 | 2 matched (ids attached) |
| Foursquare Open Source Places | 0 | gated, see blockers |

Overture is one source, not the reference. A place found elsewhere (web leads, research, seed files) that its own website confirms is added too. Coordinates then come from the website itself (schema.org data, map markers; never Google Maps embeds) or from another Overture record at exactly the confirmed street, number and postcode, which is the same building. This added places Overture does not list, such as Stray Coffee Roasters, Cafe Mona and Tante Chylla.

Overture licences seen inside the bounding box: CDLA-Permissive-2.0, Apache-2.0 (Foursquare contributions) and CC0-1.0 (AllThePlaces); no record had an OpenStreetMap source. The city boundary is the official municipality polygon from BKG VG250, used only to filter points. 47 mentions could not be placed: 18 have no website (often Instagram-only), 10 have a name shared by several places, 7 have no coordinates from any source, and 6 have a website that does not name them.

## Research and enrichment

- 901 places were researched: a search-capable model returns only URLs on the place's own website, and code checks every page. Research found 77 new websites and 328 extra pages (menus, hours, legal notices).
- Pages are read politely (site rules, one request per second per host, 30-day page cache). 204 pages were not fetched because of site rules; Instagram forbids automated access entirely.
- 18 places are in the conflict list for a human (mostly a website that gives another street than Overture, or a website that cannot be read).

## Fill rate per field

`status=open` counts records whose status is `open`.

| Field | All places (390) | Tier A/B (34) |
|---|---:|---:|
| `address.street_address` | 376 (96%) | 33 (97%) |
| `address.postal_code` | 376 (96%) | 33 (97%) |
| `status=open` | 390 (100%) | 34 (100%) |
| `opening_hours` | 237 (61%) | 28 (82%) |
| `description` | 34 (9%) | 34 (100%) |
| `roasts_own_beans` | 36 (9%) | 19 (56%) |
| `roasters_served` | 52 (13%) | 15 (44%) |
| `serving.espresso` | 98 (25%) | 15 (44%) |
| `serving.filter` | 21 (5%) | 10 (29%) |
| `serving.pour_over` | 9 (2%) | 5 (15%) |
| `serving.batch_brew` | 0 (0%) | 0 (0%) |
| `serving.cold_brew` | 5 (1%) | 1 (3%) |
| `serving.decaf` | 18 (5%) | 4 (12%) |
| `serving.plant_milk` | 51 (13%) | 10 (29%) |
| `amenities.wifi` | 11 (3%) | 2 (6%) |
| `amenities.laptop_friendly` | 5 (1%) | 1 (3%) |
| `amenities.kids_friendly` | 10 (3%) | 0 (0%) |
| `amenities.vegan_options` | 63 (16%) | 7 (21%) |
| `amenities.dogs_allowed` | 7 (2%) | 1 (3%) |
| `amenities.outdoor_seating` | 69 (18%) | 4 (12%) |
| `amenities.card_payment` | 26 (7%) | 1 (3%) |
| `amenities.cash_only` | 1 (0%) | 0 (0%) |
| `amenities.wheelchair_accessible` | 12 (3%) | 1 (3%) |
| `food.focus` | 68 (17%) | 12 (35%) |
| `food.breakfast` | 99 (25%) | 10 (29%) |
| `food.lunch` | 80 (21%) | 7 (21%) |
| `food.cakes_baked_in_house` | 47 (12%) | 3 (9%) |
| `sells_beans` | 16 (4%) | 3 (9%) |
| `sells_equipment` | 11 (3%) | 2 (6%) |
| `offers_courses` | 18 (5%) | 3 (9%) |
| `reusable_cup_systems` | 3 (1%) | 0 (0%) |
| `prices.cappuccino` | 47 (12%) | 7 (21%) |
| `operator` | 155 (40%) | 19 (56%) |
| `links.website` | 390 (100%) | 34 (100%) |
| `links.instagram` | 234 (60%) | 23 (68%) |
| `links.facebook` | 145 (37%) | 13 (38%) |
| `image` | 0 (0%) | 0 (0%) |
| `xref.overture` | 387 (99%) | 34 (100%) |
| `xref.wikidata` | 2 (1%) | 0 (0%) |

## Coverage against extract.coffee

extract.coffee lists 41 Munich cafés. We read their pages one at a time, only to measure coverage; the names are kept in an uncommitted local file and were not used to find places.

- None is closed according to our data, so all 41 count as still open.
- 34 are in the dataset (82.9%), all confirmed open; 4 with complete core fields.
- The 7 missing ones could not be confirmed on their own website in this run, or have no coordinates from any of the sources below.

## Images

No tier A place has an image. Only Wikimedia Commons files whose title contains the place's full name, or a place's Wikidata image, are accepted (a looser rule matched market stalls and church towers), and none qualified. Owners can suggest openly licensed photos through `CONTRIBUTING.md`.

## Google verification

Not run: there is no key. How it would work is described in [`docs/agent.md`](../agent.md#google-verification-not-enabled).

## Timing and cost

- A full Munich run with a cold cache takes about 35 minutes (research is the slowest step); with the page and model caches a rerun takes about 13 minutes.
- Estimated model cost of all runs on 2026-11-05: about $95 (two full research runs cost about $45 each; reruns now hit the model cache). The research model has no published gateway price, so its cost is an estimate (see `docs/agent.md`).

## Fields that cannot be filled from open sources

- `external_ratings`, `xref.google_place_id`: not collected (no review sites, no Google key).
- `awards`, `good_for`: rarely stated on café websites.
- `image` for most cafés: no openly licensed photos exist yet.

## Blockers

- **Foursquare Open Source Places** is gated on Hugging Face (account, organisation details and a marketing-use clause); a decision for the maintainers.
- **Instagram** forbids automated access, so Instagram-only cafés cannot be confirmed.
- **Coordinates** for places missing from Overture: no open source without attribution requirements (Bavaria's house coordinates are CC BY 4.0).

## Next steps

1. **Read menu images** on the place's own website (text recognition, then the same quote checks). Menus are where espresso, filter, plant milks and food are stated, and they are often images.
2. **Schema fields people ask for** that cafés state on their menus: which milk alternatives (oat, soy, almond …), whether and what food is served, brew methods, takeaway, vegetarian/vegan/gluten-free, other drinks, seating, power sockets. These need a schema version that adds them.
3. Research again for places still without a website, with other queries (former names, operator names).
