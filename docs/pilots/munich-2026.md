# Munich pilot, November 2026

The first city built with the data agent ([`docs/agent.md`](../agent.md)). Run on 2026-11-05 against Overture release `2026-10-21.0`. The data is in [`datasets/coffee-places/de/munich.json`](../../datasets/coffee-places/de/munich.json).

Every stored value was confirmed in this run on a page we fetched (the place's own website, a roaster's page) or comes from an Overture record, and passed the deterministic checks. Uncertain values are absent. The run log with the page and quote behind each value is in `.cache/runs/` and is not committed.

## Result against the acceptance criteria

| Criterion | Target | Result | Met |
|---|---|---|---|
| Coverage of extract.coffee's still-open Munich cafés | ≥ 90% | 36 of 41 (87.8%) | no |
| Tier A/B places with complete core fields | ≥ 60 | 9 (7 A, 2 B) | no |
| Validation passes, nothing non-redistributable committed | yes | `scripts/validate.sh`: 0 errors (30 style warnings for hours past midnight); no page text, images or third-party lists committed | yes |

Neither data target is met. The main reasons are below ("Why the targets are missed"). We did not lower the bar to reach them: a value nobody confirmed stays out.

The SPEC's candidates CSV and its 59-place ground truth list were never provided, so there is no comparison against them.

## Places per tier

| Tier | Places |
|---|---:|
| A (specialty-focused) | 23 |
| B (serves specialty) | 18 |
| none (not specialty: chains, restaurants, bakeries, non-coffee businesses) | 228 |
| unknown (no specialty evidence found) | 803 |
| **Total** | **1072** |

Status: 354 `open` (website fetched in this run and it names the place and its address), 718 `unverified` (found in open data, not yet confirmed by a primary page). None is marked `closed`. Overture places flagged `permanently_closed` were not added (59).

"Unknown" is large on purpose: 277 places have no website, and many café websites never name a roaster or describe their coffee, so there is nothing to base a tier on.

## Discovery

| Source | Count | Notes |
|---|---:|---|
| Overture places in coffee categories inside the city boundary | 1,099 | `cafe`, `coffee_shop`, `coffee_roastery`, `coffee_and_tea_supplies` (primary or alternate); 59 more were `permanently_closed` and skipped |
| after merging Overture duplicates | 1,064 | 35 duplicate records merged |
| Roaster pages (14 roasters, 20 pages) | 23 mentions | 6 matched existing places, 5 added (Overture places in other categories), 12 could not be located |
| Web search (names and websites, 116 queries) | 103 places | 88 matched existing places, 14 added; the rest could not be placed |
| Wikidata cafés | 5 | 2 matched (ids attached); 3 had no Overture counterpart |
| Foursquare Open Source Places | 0 | gated, see blockers |
| **Places in the file** | **1072** | |

- Overture licences seen inside the bounding box: CDLA-Permissive-2.0 (all records), Apache-2.0 (records with a Foursquare contribution) and CC0-1.0 (AllThePlaces). No record had an OpenStreetMap source, so none was dropped.
- The city boundary is the official municipality polygon from BKG VG250 (key 09162000). It is used only to filter points.
- Only one roaster publishes a list of third-party cafés in Munich (Merchant & Friends). The others list only their own cafés (Man Versus Machine, The Barn, Suuapinga, Vits, ALRIGHTY, Stray and more). Roaster pages are therefore a small source here, unlike the SPEC's expectation.
- 45 mentions could not be placed, mostly because Overture has no place at that name or address, and coordinates need an open source (see blockers).

## Website finding

- Before the website search, 601 places that are not tier none had no verified website.
- The search found candidates for 110 of the 201 places it reached (197 queries, one per place). 20 of those candidates passed verification: the site names the place and shows its street or postcode.
- 400 places were never searched. The session's web-search quota (about 200 searches) ran out. There is no search API key for the agent; see blockers. Failures are logged in `.cache/discovery/munich-websites.json`.
- Sites listed in Overture often turned out to be parked domains, domains for sale or dead (DNS failure or expired certificate). The verification rejects them. Dead sites are a closure signal for the next run.

## Enrichment

- Websites fetched for 808 places; 367 matched the place (name plus street or postcode on the site).
- 55 sites were not read because their access rules exclude us. Instagram forbids automated access entirely.
- 2,374 distinct pages in the page cache (homepage plus up to 7 subpages per site, including up to 2 menu PDFs). 123 pages were rendered headless in the first run because plain HTTP returned too little text.
- One extraction call per matched site (Claude Haiku 5.5); 16 replies were not valid JSON and were retried once with Claude Sonnet 5.5.
- Rejected proposals in the final run: 420. The most common reasons were "quote does not support the value" (for example "SPECIALTY COFFEE BEANS" offered as proof of selling beans in this café), "times not in quote" and "fact not tied to this location" on sites with several branches.
- No page text tried to address the model (0 lines removed by the injection guard), so the guard was not exercised by real attacks.
- 18 places were held back as conflicts: the place's single-location website gives a different street than Overture. That usually means the place moved, but without trusted coordinates for the new address we leave it out. They are listed in the run log for a human.

## Fill rate per field

`status=open` counts records whose status is `open`.

| Field | All places (1072) | Tier A/B (41) |
|---|---:|---:|
| `address.street_address` | 1030 (96%) | 40 (98%) |
| `address.postal_code` | 991 (92%) | 40 (98%) |
| `status=open` | 354 (33%) | 39 (95%) |
| `opening_hours` | 220 (21%) | 32 (78%) |
| `open_sunday` | 220 (21%) | 32 (78%) |
| `description` | 41 (4%) | 41 (100%) |
| `roasts_own_beans` | 41 (4%) | 24 (59%) |
| `roasters_served` | 52 (5%) | 23 (56%) |
| `serving.espresso` | 82 (8%) | 17 (41%) |
| `serving.filter` | 22 (2%) | 11 (27%) |
| `serving.pour_over` | 6 (1%) | 2 (5%) |
| `serving.batch_brew` | 1 (0%) | 1 (2%) |
| `serving.cold_brew` | 7 (1%) | 2 (5%) |
| `serving.decaf` | 17 (2%) | 3 (7%) |
| `serving.plant_milk` | 36 (3%) | 7 (17%) |
| `amenities.wifi` | 10 (1%) | 3 (7%) |
| `amenities.laptop_friendly` | 4 (0%) | 1 (2%) |
| `amenities.kids_friendly` | 12 (1%) | 0 (0%) |
| `amenities.vegan_options` | 59 (6%) | 7 (17%) |
| `amenities.dogs_allowed` | 7 (1%) | 1 (2%) |
| `amenities.outdoor_seating` | 70 (7%) | 7 (17%) |
| `amenities.card_payment` | 28 (3%) | 2 (5%) |
| `amenities.cash_only` | 5 (0%) | 0 (0%) |
| `amenities.wheelchair_accessible` | 7 (1%) | 1 (2%) |
| `food.focus` | 77 (7%) | 22 (54%) |
| `food.breakfast` | 81 (8%) | 7 (17%) |
| `food.lunch` | 67 (6%) | 6 (15%) |
| `food.cakes_baked_in_house` | 44 (4%) | 5 (12%) |
| `sells_beans` | 24 (2%) | 7 (17%) |
| `sells_equipment` | 13 (1%) | 4 (10%) |
| `offers_courses` | 17 (2%) | 5 (12%) |
| `reusable_cup_systems` | 3 (0%) | 0 (0%) |
| `prices.cappuccino` | 38 (4%) | 6 (15%) |
| `operator` | 151 (14%) | 22 (54%) |
| `links.website` | 354 (33%) | 39 (95%) |
| `links.instagram` | 228 (21%) | 28 (68%) |
| `links.facebook` | 144 (13%) | 19 (46%) |
| `image` | 0 (0%) | 0 (0%) |
| `xref.overture` | 1072 (100%) | 41 (100%) |
| `xref.wikidata` | 2 (0%) | 0 (0%) |

Core fields of tier A/B places that are still missing: `serving.filter` (30 places), `serving.espresso` (24), `opening_hours` (9), status not `open` (2), website or Instagram (2), street and postcode (1).

## Coverage against extract.coffee

extract.coffee lists 41 Munich cafés. We read their pages one at a time, only to measure coverage. The names are kept in `.cache/coverage/` and are not committed. The comparison ran after discovery and was not used to find places.

- None of the 41 is closed according to our data, so all 41 count as still open.
- 36 are in the dataset (87.8%): 17 tier A, 4 tier B, 1 none, 14 unknown; 27 confirmed `open`; 6 with complete core fields.
- Of the 5 missing, 4 have no record at their street and house number at all: they are not in Overture's places in Munich. One shares an address with a record of a different name; it may be another business in the same building, so we did not merge it.

extract.coffee shows, per café, hours, a rating, photos, amenities and an AI-written description, matched from Google Maps. We store hours where the café's own site publishes them (78% of tier A/B), no ratings (only rating links are allowed and none were collected), and our own descriptions generated from stored fields. The amenity fields we could fill from open sources are in the table above; most stay low because cafés rarely state them on their websites.

## Images

- No tier A place has an image (0 of 23).
- The first image pass matched Commons files near a place whose title shared one word with its name. That picked a cheese stall at Viktualienmarkt, a church tower for "Turm Kaffee" and the wrong house for "Café Königin 43", so the rule was tightened: the file title must contain the place's full name, or the image must be the place's Wikidata image. Under that rule nothing qualifies. Wikidata has images only for a few traditional coffee houses (for example Café Luitpold), which are not tier A.
- Mapillary needs an API token, and Panoramax street images cannot be confirmed automatically to show a given café.
- To close the gap, ask owners to contribute their own photos under an open licence through the claim process in `CONTRIBUTING.md`, and upload them to Wikimedia Commons with the café's name in the title.

## Google verification

Not run: there is no key. How it would work, if maintainers enable it, is described in [`docs/agent.md`](../agent.md#google-verification-not-enabled): only for places already in the dataset, store nothing but `xref.google_place_id`, and turn a reported closure into a review item.

## Timing and cost

Wall-clock times per stage (UTC, 2026-11-05):

| Stage | Time |
|---|---|
| Reading the brief, repository and schema; testing data access | 18:37–18:42 |
| Web-search discovery (one search agent, in parallel with building the agent) | 18:42–18:55, 13 min |
| Building the agent, tests and a 20-place dry run | 18:42–19:08 |
| First full run, cold page cache: discover 141 s, enrich 714 s, build 9 s, images 12 s | 19:08–19:23, 14.6 min (0.8 s per place) |
| Review and fixes (multi-branch facts, dead sites, PDF menus, tier rule) | 19:23–19:43 |
| Website search for places without a site (four search agents) | about 2.5 min |
| Final run, warm page cache: discover 153 s, enrich 314 s, build 4 s, images 10 s | 20:00–20:08, 8 min |
| Checks, coverage, image correction, report | 20:08–20:30 |
| **Total** | **about 1 h 55 min** |

A city of this size takes about 15 minutes with a cold cache, most of it waiting for one request per second per host.

Model cost:

| Item | Cost |
|---|---|
| Final run: 428 calls, 4.78 M input and 0.81 M output tokens ($0.86 Haiku, $0.53 Sonnet escalations) | $1.38 |
| All runs this month, including the first full run, the dry runs and the failed run | $3.96 |

The search agents used about 620,000 Claude tokens in the development session; that is not part of the agent's own cost. There were no other API costs (Overture, BKG, Wikidata and Commons are free).

## Why the targets are missed

1. **Filter coffee and espresso are rarely stated.** Specialty roasteries list their coffees ("Espresso blend", "Filter roast") as beans for sale. That does not show the café serves those drinks, and the verifier rejects it. Menus are often images, so `serving.filter` is known for only 27% of tier A/B places. This is the field that most often blocks "complete core fields".
2. **Specialty evidence is thin.** Many cafés that serve specialty coffee never name their roaster or describe their coffee on their own website. Without that, the tier stays unknown. The Instagram bio is often the only such statement, and it cannot be read.
3. **Websites are missing or wrong** for many places in open data, and the search quota covered only a third of them.
4. **Places missing from Overture** have no open source of coordinates: Overture has no German address points, and other geocoders are either OpenStreetMap-based or not openly licensed.

## Fields that cannot be filled from open sources

- `external_ratings`: a link would need the review site's own id, and we do not scrape review sites.
- `xref.google_place_id`: needs a Google key (verification only).
- `awards`, `good_for`: rarely stated on café websites; we only store what a page says.
- `amenities.*` and `serving.*` beyond what the café's own site states: these are the fields extract.coffee fills from Google Maps.
- `image` for most cafés: no openly licensed photos exist yet.

## Blockers

- **Foursquare Open Source Places** moved to a gated Hugging Face dataset. Access needs an account and accepting terms that let Foursquare name the organisation in its marketing. That is a maintainer decision; not done.
- **Instagram** forbids automated access in its site rules and terms. Instagram-only places (27 from web search) can be found but not verified.
- **Web search** has no API key for the agent. Brave Search would cost money, a decision for the maintainers. The development session's quota of about 200 searches limited website finding.
- **Coordinates** for places missing from Overture: Bavaria publishes official house coordinates (Hauskoordinaten) as open data under CC BY 4.0. Using them needs a decision on attribution in an MIT dataset.
- **Schema v0.1.0 is not tagged yet**, so CI fetches of the released schema fail until the tag exists. Local validation uses the schema checkout.

## Schema proposals

These are proposals for `open-coffee-schema`; nothing was changed there.

1. **What visitors can do there.** Several Munich roasteries run a shop or roast for wholesale only, and one sells online only. The agent needed its own rule ("serves visitors") to keep those out of tier A. A field such as `serves_drinks` (boolean), or `kind` (`cafe`, `coffee_bar`, `roastery_shop`, `roastery`, `restaurant`, `bakery`, …), would record that and let consumers filter.
2. **`links.menu`**: the menu page or PDF is the most useful link for coffee details and is often separate from the homepage.
3. **A review hint for moved places**: a place whose website shows a new address currently cannot be stored without coordinates. An optional `address_unconfirmed` flag, or allowing `location` to be absent when `status` is `unverified`, would let such records exist until coordinates are found.
