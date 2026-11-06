# Munich pilot, November 2026

The first city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`. The data is in [`datasets/coffee-places/de/munich.json`](../../datasets/coffee-places/de/munich.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset. Each record's values come from that website, the Overture record and code checks: a value proposed by the model is kept only if its quote occurs on the fetched page and the field's deterministic check passes, and the data linter runs before anything is written. Places that could not be confirmed are not in the repository; the agent keeps them in a local, uncommitted archive for later work.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 16 |
| Tier B (serves specialty) | 15 |
| none (not specialty: chains, bakeries, bars …) | 68 |
| unknown (confirmed, but no specialty evidence on its own site) | 167 |
| **Total** | **266**, all open |

Every place is a café, coffee bar or similar that anyone can walk into, confirmed on its own website (that is also how it got its name). 98% have a street and postcode, and 71% have opening hours (90% of tier A/B).

## Result against the acceptance criteria

| Criterion | Target | Result | Met |
|---|---|---|---|
| Coverage of extract.coffee's still-open Munich cafés | ≥ 90% | 32 of 41 (78.0%) | no |
| Tier A/B places with complete core fields | ≥ 60 | 17 (11 A, 6 B) | no |
| Validation passes, nothing non-redistributable committed | yes | `scripts/validate.sh` against the released v0.3.0 schema: 0 errors; data lint: 0 errors | yes |

Both data targets are missed, and the coverage is lower than in the first version of this report (87.8%) on purpose: places that could not be confirmed on their own website are no longer in the file. The core field that is most often missing for tier A/B places is filter coffee (12 of 31 unknown); espresso is unknown for 6 of 31.

The SPEC's candidates CSV and its 59-place ground truth list were never provided, so there is no comparison against them.

## Corrections since the first publication

The first published file (1,076 records) had defects that an independent review and the new data linter found. All are fixed:

- **Wrong websites.** The site check accepted any name word, including district, street and month names, so a coffee chain's locations page became the website of neighbouring shops (for example a locations page matched "Mai Asia", "Naturkosmetik Schwabing" and three shops on Gärtnerplatz). The check now ignores district, street, city and generic words, and needs the whole name or every distinctive word. Records whose re-read website does not name them left the dataset.
- **Platform pages as websites** (Gelbe Seiten, Lieferando, speisekartenweb, gastroguide, Facebook) and every value read from them were removed; platform pages are never used.
- **Wrong tiers.** Places on a roaster's reference or stockist list (a bike shop, a beer hall, a restaurant) were tier B. Roaster lists are no longer used at all; a roaster counts only when the place's own website names it with a specialty claim, and tier A/B needs status open.
- **Evidence rules.** A quote that negates a value ("kein WLAN") no longer supports `true`; "Speisekarte" no longer counts as card payment, "Hotdog" not as dogs allowed, a supplier mention not as own roasting, a bare "250 g" not as selling beans, and "Barzahlung" not as cash only.
- **Branches of one business.** Facts about what a business serves and sells (espresso, filter, beans, equipment) now count for every branch unless the quote sits next to another branch's address; hours, amenities, meals and courses still have to be tied to the branch. Branch numbers ("Two", "II") no longer block matching a branch to its website.
- **Other fixes:** Facebook share links, owners' names inside place names, an email address in a street, seasonal venues (Oktoberfest tents are not stored at all; only places open all year are), non-coffee businesses at discovery (75 excluded), 3 confirmed duplicates (Hochlandkaffee into Pachamama, Maxim Kaffee into Groove Coffee Club, and the operator name "Christoph Jünger Gastronomie" into cafe Clara).
- **Wrong values and places that are not cafés** (a second audit checked every stored value of the 402 places against the fetched pages: 204 places had at least one wrong value, 79 were not cafés). Each place now also needs a model check, backed by a quote that is on the page, that the website is the place's own and that the public can walk in and order a coffee there; restaurants, shops, schools, catering, members-only and host-venue sites (museum, zoo, hospital, bus station) and directory pages no longer confirm a place. The name is the one the place uses on its own site. Shop, catalogue, wiki, blog and catering pages no longer count as what a place serves (a chain's coffee wiki alone had given its branches 41 wrong values), nor do allergen lists, dishes ("Thai-Curry mit Kokosmilch") or teas. Instagram and Facebook links count only when the handle matches the place or its site. Closure notices are recognised more widely. Two remaining duplicates (an online shop listed under two names, a roaster's shop next to its café) left with the non-cafés. 402 places became 266.
- **Facts that were on the site but missed** (an audit of every place against its own pages found them for about 180 places). Menus that are only photos are now transcribed and checked like page text (329 menu images from 145 sites); PDFs linked from the site are read even on a file server; text in a page's own data (JSON-LD, Next.js page data) counts; clear menu lines ("Hafermilch", "entkoffeiniert", "Frühstück") are proposed by a keyword pass besides the model; a chain's facts count for every branch unless the quote sits next to another branch's address. Before the second audit this raised espresso from 112 to 204 places, but part of that came from shop pages and a chain's coffee wiki and was removed again (see above).
- **Wrong values the audit found.** A roaster named as a partner ("with", "wer sie röstet") no longer counts as own roasting, a home-brewing guide no longer counts as the café serving pour-over, and tier A now needs specialty wording, not just the word "roasting". Negations after the field word ("Hunde nicht erlaubt") are recognised.
- **Not cafés.** Online shops, barista schools, office coffee services, staff canteens, manufacturers, playgrounds and youth centres without café service are no longer stored (for example a coffee web shop, a tea shop and a machine dealer), nor are places that close for the winter (berry-farm cafés) or a cake business whose site never mentions coffee.
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

Overture licences seen inside the bounding box: CDLA-Permissive-2.0, Apache-2.0 (Foursquare contributions) and CC0-1.0 (AllThePlaces); no record had an OpenStreetMap source. The city boundary is the official municipality polygon from BKG VG250, used only to filter points. 50 mentions could not be placed: 18 have no website (often Instagram-only), 10 have a name shared by several places, 9 have no coordinates from any source, 10 have a website that does not name them, shows no address or is not a café, and 3 others.

## Research and enrichment

- 875 places were researched: a search-capable model returns only URLs on the place's own website, and code checks every page. Research found 119 new websites and 213 extra pages (menus, hours, legal notices).
- Pages are read politely (site rules, one request per second per host, 30-day page cache). 262 pages were not fetched because of site rules; Instagram forbids automated access entirely.
- 10 places are in the conflict list for a human (mostly a website that gives another street than Overture, or a website that cannot be read).

## Fill rate per field

`status=open` counts records whose status is `open`.

| Field | All places (266) | Tier A/B (31) |
|---|---:|---:|
| `address.street_address` | 261 (98%) | 31 (100%) |
| `address.postal_code` | 260 (98%) | 31 (100%) |
| `status=open` | 266 (100%) | 31 (100%) |
| `opening_hours` | 188 (71%) | 28 (90%) |
| `description` | 31 (12%) | 31 (100%) |
| `roasts_own_beans` | 31 (12%) | 16 (52%) |
| `roasters_served` | 58 (22%) | 17 (55%) |
| `serving.espresso` | 165 (62%) | 25 (81%) |
| `serving.filter` | 54 (20%) | 19 (61%) |
| `serving.pour_over` | 18 (7%) | 14 (45%) |
| `serving.batch_brew` | 5 (2%) | 4 (13%) |
| `serving.cold_brew` | 14 (5%) | 8 (26%) |
| `serving.decaf` | 56 (21%) | 15 (48%) |
| `serving.plant_milk` | 61 (23%) | 7 (23%) |
| `amenities.wifi` | 15 (6%) | 5 (16%) |
| `amenities.laptop_friendly` | 2 (1%) | 1 (3%) |
| `amenities.kids_friendly` | 14 (5%) | 0 (0%) |
| `amenities.vegan_options` | 93 (35%) | 8 (26%) |
| `amenities.dogs_allowed` | 6 (2%) | 1 (3%) |
| `amenities.outdoor_seating` | 71 (27%) | 5 (16%) |
| `amenities.card_payment` | 27 (10%) | 3 (10%) |
| `amenities.cash_only` | 1 (0%) | 0 (0%) |
| `amenities.wheelchair_accessible` | 7 (3%) | 1 (3%) |
| `food.focus` | 57 (21%) | 15 (48%) |
| `food.breakfast` | 130 (49%) | 11 (35%) |
| `food.lunch` | 95 (36%) | 6 (19%) |
| `food.cakes_baked_in_house` | 54 (20%) | 3 (10%) |
| `sells_beans` | 28 (11%) | 14 (45%) |
| `sells_equipment` | 15 (6%) | 10 (32%) |
| `offers_courses` | 10 (4%) | 4 (13%) |
| `reusable_cup_systems` | 5 (2%) | 0 (0%) |
| `prices.cappuccino` | 43 (16%) | 5 (16%) |
| `operator` | 127 (48%) | 16 (52%) |
| `links.website` | 266 (100%) | 31 (100%) |
| `links.instagram` | 161 (61%) | 26 (84%) |
| `links.facebook` | 108 (41%) | 14 (45%) |
| `image` | 0 (0%) | 0 (0%) |
| `xref.overture` | 262 (98%) | 30 (97%) |
| `xref.wikidata` | 2 (1%) | 0 (0%) |

## Coverage against extract.coffee

extract.coffee lists 41 Munich cafés. We read their pages one at a time, only to measure coverage; the names are kept in an uncommitted local file and were not used to find places.

- None is closed according to our data, so all 41 count as still open.
- 32 are in the dataset (78.0%), all confirmed open; 14 with complete core fields.
- Of the 9 missing ones, one has closed for good, one has no website of its own (only a menu platform), and the others could not be confirmed on their own website or have no coordinates from any source.

## Images

No tier A place has an image. Only Wikimedia Commons files whose title contains the place's full name, or a place's Wikidata image, are accepted (a looser rule matched market stalls and church towers), and none qualified. Owners can suggest openly licensed photos through `CONTRIBUTING.md`.

## Google verification

Not run: there is no key. How it would work is described in [`docs/agent.md`](../agent.md#google-verification-not-enabled).

## Timing and cost

- A full Munich run with a cold cache takes about 35 minutes (research is the slowest step); with the page and model caches a rerun takes about 13 minutes.
- Estimated model cost of all runs on 2026-11-05: about $95; the reruns on 2026-11-06 cost about $60 in total, mostly the new café check (one Sonnet call per place, about $20 per full run) (two full research runs cost about $45 each; reruns now hit the model cache). The research model has no published gateway price, so its cost is an estimate (see `docs/agent.md`).

## Fields that cannot be filled from open sources

- `external_ratings`, `xref.google_place_id`: not collected (no review sites, no Google key).
- `awards`, `good_for`: rarely stated on café websites.
- `image` for most cafés: no openly licensed photos exist yet.

## Blockers

- **Foursquare Open Source Places** is gated on Hugging Face (account, organisation details and a marketing-use clause); a decision for the maintainers.
- **Instagram** forbids automated access, so Instagram-only cafés cannot be confirmed.
- **Coordinates** for places missing from Overture: no open source without attribution requirements (Bavaria's house coordinates are CC BY 4.0).

## Next steps

1. **Schema fields people ask for** that cafés state on their menus: which milk alternatives (oat, soy, almond …), whether and what food is served, brew methods, takeaway, vegetarian/vegan/gluten-free, other drinks, seating, power sockets. These need a schema version that adds them.
2. Research again for places still without a website, with other queries (former names, operator names).
