# Data agent

The data agent (workflow `data-agent.yml`, display name "Data agent") finds coffee places in a city, confirms facts about them on primary pages and proposes the result as **one pull request per city**. It never merges and never pushes to `main`: every pull request gets human review. Code lives in [`agent/`](../agent/) (a Bun package); the entry point is [`scripts/agent.sh`](../scripts/agent.sh).

## The rule behind everything

A value is stored only when it was confirmed in this run on a primary page we fetched (the place's own website, a roaster's partner or own-café page, or an allow-listed open dataset record) and the deterministic checks pass. If anything is uncertain, the field stays absent (unknown). `false` is stored only when a page says so ("Kein WLAN"). Records carry only the values themselves, no provenance or confidence fields; where each value came from is written to the run log (`.cache/runs/<run>/<city>.log.json`, gitignored) and summarised, with links, in the pull request.

## What one run does

1. **Pick a city.** `--city <slug>`, or the first city in [`agent/config/cities.json`](../agent/config/cities.json) with queued work, else the first configured city without a dataset file.
2. **Discover** (`discover`):
   - **City limits** come from the city's `boundary` in `cities.json`: `bkg-vg250` (German municipality by official key, BKG open data), `swisstopo` (Swiss municipality by BFS number) or `geojson` (any URL, optional property filter). Austrian cities have no boundary yet and are skipped until a maintainer adds one. Boundaries only filter points; they are never stored.
   - **Overture Maps places**, read with DuckDB from the public S3 bucket (`OVERTURE_RELEASE`). Coffee categories `cafe`, `coffee_shop`, `coffee_roastery`, `coffee_and_tea_supplies` (primary or alternate), not `permanently_closed`. A record is kept only if every contributing dataset is licensed CDLA-Permissive-2.0, Apache-2.0, CC0-1.0 or CC-BY-4.0 and none of them is OpenStreetMap. The run reports the licences it saw.
   - **Foursquare Open Source Places** is not used yet: the release is gated on Hugging Face (account, organisation details and a marketing-use clause). See "Blockers".
   - **Wikidata** (CC0) cafés in the city's bounding box only attach `xref.wikidata` and an image to places we already have.
   - **Roaster pages** from [`agent/config/roasters.json`](../agent/config/roasters.json). The model lists each place on the page with a quote; an entry is kept only if the quote occurs on the page and contains the name. A roaster counts as specialty only if its own pages say "specialty", "single origin" or similar (checked in code).
   - **Web search** (see `BRAVE_SEARCH_API_KEY` below) gives names and websites. A search result is never evidence: the place's own site must name it and show its address, and Overture must have a place at that address (for coordinates), or the site must publish schema.org coordinates for it.
   - Duplicates merge by name similarity and distance (≤150 m at high similarity, ≤50 m at medium), by the same street and house number, or by the same own website at the same spot (one website can cover several branches).
3. **Filter**: chains and clearly non-coffee businesses ([`agent/config/classify.json`](../agent/config/classify.json)) without a website are not fetched and get `specialty_tier: none`. They stay in the dataset.
4. **Enrich** (`enrich`): fetch the place's website (homepage plus up to 7 linked pages: legal notice, hours, contact, menu, about, shop, courses; up to 2 of them may be menu PDFs, read as text). Pages with too little text are rendered once in headless Chromium. The site must name the place and show its street or postcode, otherwise it is not used. One LLM call per place proposes facts; [`verify()`](../agent/src/extract.ts) keeps a proposal only if:
   - its quote occurs on the cited page (normalised for whitespace, dashes and case);
   - the quote mentions the field (for example `serving.filter` needs "filter", "V60", "batch brew" and the like); `false` needs a negation;
   - opening hours parse with the `opening_hours` library and every clock time in the value occurs in the quote; on sites with several locations the quote must sit near this location's street;
   - the operator is a legal entity (GmbH, UG, AG, KG, e.V. …) taken from a legal notice; natural persons, sole traders (e.K., "Inhaber") and GbRs are never stored;
   - postcodes have the country's format and occur among the city's open-data postcodes;
   - contradicting values on one site cancel each other (the field stays unknown).
5. **Find websites** (`websites`): places without a matching website get up to 3 searches when a search provider is configured; each candidate site is verified as above. Failures are logged.
6. **Build records.** Coordinates come from Overture. The website's address wins when it is the same street; if a single-location site gives another street, the agent looks for an Overture place at the new address, otherwise it records a conflict and leaves the place out (new) or unchanged (existing). Status is `open` only when the website was fetched and matched in this run (`last_verified_at` is that time), `closed` or `temporarily_closed` only on a quoted notice, otherwise `unverified`. `open_sunday` is derived from the hours. Instagram and Facebook links come from the place's own website (exactly one profile linked) or Overture. Tiers follow fixed rules ([`agent/src/tier.ts`](../agent/src/tier.ts)):
   - **A**: roasts its own beans, or serves a specialty roaster (from a roaster's page, or named on the site together with a specialty claim), and the place is coffee-led (site says so, or it is a roastery or a coffee bar with filter coffee).
   - **B**: the same specialty evidence, but food or something else leads, or coffee-led is not shown.
   - **none**: a chain, only commodity brands (Lavazza, Segafredo …), or the site shows a restaurant, bakery, bar, hotel, ice cream parlour or shop without specialty evidence, or the name shows such a business.
   - **unknown**: everything else, and any place with specialty evidence but no sign that it serves visitors (no opening hours, no serving fact, not a café on a roaster's list), such as wholesale-only roasteries.
   Descriptions are generated by a template from the stored fields only (no page text, no LLM), for tier A and B.
7. **Images** (`images`): for tier A places, the Wikidata image or a Wikimedia Commons file within 120 m whose title contains the place's full name (a shared word is not enough: it matched market stalls and church towers in Munich), if its licence is CC0, CC BY, CC BY-SA or public domain. `image.url` links the original file on upload.wikimedia.org with `licence`, `author` and `source_url`. Nothing is copied into the repository.
8. **Write and propose**: write `datasets/coffee-places/<cc>/<city>.json` (records ordered by id, keys in schema order), print metrics (also to the workflow's job summary) and open the pull request.

## Queue and refresh

The queue is derived from the records and a small state ledger (`SOURCING_STATE_DIR/<city>.json`, kept in the workflow cache, never committed; if it is lost, places are simply enriched again):

1. never enriched (new places, and records missing from the ledger);
2. conflicts (dead website, address contradicting open data, missing coordinates);
3. not verified for more than 90 days: a quarterly refresh of opening hours and status only; records not checked for 182 days get a full refresh of every field, so twice a year;
4. new cities in order: Berlin, Hamburg, Munich, Cologne, Frankfurt, Düsseldorf, Leipzig, Stuttgart, then German cities over 100,000 inhabitants (from Wikidata, by population), then Austria and Switzerland.

A dead website (DNS failure, 404/410, refused connection) on a place that was `open` sets `status: unverified` and puts it in the conflict queue, so it is re-checked on the next run. Within a priority, tier A comes first, then B, unknown and none, oldest verification first. `--limit` sets the batch; use 20–50 for scheduled runs so pull requests stay reviewable.

## Pull requests

- One per city and run, branch `data-agent/<city>-<date>-<id>`, created with GitHub's `createCommitOnBranch` so the commit is signed by the App.
- The data agent only writes `datasets/coffee-places/**`; `agent/src/pr.ts` refuses anything else, and CI should enforce the same.
- The body summarises changes by field: old → new value, a link to the page that confirmed it and the quoted snippet, plus conflicts and run metrics.
- Labels point reviewers at what needs a closer look: `closure`, `tier-change`, `new-domain` (a website not seen before), `conflict`, `image`, always `data-agent`.
- Nothing is merged automatically.

## Budget and metrics

- `SOURCING_BUDGET_USD` (default 25) is a monthly hard stop across runs; `SOURCING_RUN_BUDGET_USD` (default 10) caps one run. The agent checks before every LLM call and stops cleanly; unprocessed places stay queued.
- Cost is estimated from the token counts the gateway returns: Claude Haiku 5.5 at $0.10 / $0.50 per million input / output tokens, Sonnet 5.5 at $2 / $10. The ledger is `SOURCING_STATE_DIR/budget.json`.
- Every run writes metrics to stdout, `$GITHUB_STEP_SUMMARY`, `SOURCING_METRICS_PATH` and `.cache/runs/<run>/`: places touched, fields changed (per field), tiers, tier A/B with complete core fields, LLM calls, tokens and cost, pages fetched, pages not fetched because of site rules, errors, time per stage and per place, and fill rate per field for the city (all places and tier A/B).

## Configuration and secrets

| Variable | Needed | Purpose |
| --- | --- | --- |
| `LLM_BASE_URL`, `LLM_API_KEY` | yes | OpenAI-compatible chat completions gateway and its key (secret) |
| `LLM_MODEL` | no | Extraction model, default `claude/claude-haiku-5-5` |
| `LLM_ESCALATION_MODEL` | no | Used once when the extraction reply is not valid, default `claude/claude-sonnet-5-5` |
| `GH_TOKEN` | for PRs | Installation token of the GitHub App whose login is `roastbook-sourcing[bot]`: contents write and pull requests write on this repository only (created in the workflow from `SOURCING_APP_ID` and the secret `SOURCING_APP_PRIVATE_KEY`) |
| `SOURCING_BUDGET_USD`, `SOURCING_RUN_BUDGET_USD` | yes | Monthly hard stop and per-run cap |
| `SOURCING_STATE_DIR` | in CI | Budget ledger and queue state; restore it with `actions/cache` |
| `BRAVE_SEARCH_API_KEY` | no | Enables web search for discovery and website finding. Brave Search is a paid API, so turning it on is the maintainers' decision. Without it, discovery uses open data, roaster pages and an optional seed file `.cache/discovery/<city>-search.json` (`{"places": [{"name", "website"}]}`) from a search done elsewhere. A second file, `.cache/discovery/<city>-websites.json` (`{"found": [{"id", "website"}]}`), adds candidate websites for existing records; they are verified like any other site. |
| `OVERTURE_RELEASE` | no | Overture release, e.g. `2026-10-21.0`; bump it monthly |
| `SOURCING_CACHE_DIR` | no | Page cache (`pages/`, 30 days), boundaries, Overture extracts and run logs; default `.cache/` |

## Usage

```sh
scripts/agent.sh --city munich --limit 50              # full run, opens a pull request
scripts/agent.sh --city munich --limit 2000 --no-pr    # write the city file locally, no pull request
scripts/agent.sh --city munich --dry-run               # nothing written (still fetches pages and calls the LLM)
scripts/agent.sh                                       # next city from the queue
cd agent && bun test                                   # unit tests: dedupe, ids, hours, evidence check, injection guard, site rules
```

## Safety

- **Allowed inputs.** Never Google Maps or the Places API, OpenStreetMap data, extract.coffee, European Coffee Trip, roasters.app, Caffe Atlas or review sites. Search results from those hosts are discarded. `scripts/config/denylist.json` is enforced on every URL in the dataset by CI.
- **Reading websites politely.** Each site's access rules are honoured (RFC 9309: if the rules file cannot be read because of a server error, nothing on that site is fetched). Requests send the User-Agent `RoastbookOpenCoffee/1.0 (+https://github.com/Roastbook/open-coffee-data)`, at most one request per second per host, and pages are kept for 30 days in the page cache `.cache/pages/`. Fetched text and photos are never committed. The headless browser loads no images, media, fonts or stylesheets. Instagram's rules forbid automated access, so Instagram bios are not read.
- **Prompt injection.** Instructions live only in the system prompt. Page text goes into the user message inside `<untrusted id="<random nonce>">` fences; fake fence tags inside pages are defused and lines that address an AI model are dropped and counted. The reply must parse and validate against a JSON Schema, and then every value still has to pass the evidence check, so injected text can at most make the agent store a value that is really on the page.
- **Personal data.** Operators are stored only as legal entities from a legal notice; no person names, emails or phone numbers.
- **Facts only.** Descriptions are generated from stored fields; quotes are used for checking and appear only in the run log and the PR body.

## Google verification (not enabled)

There is no Google key, so the agent does not use Google at all. If maintainers enable it, it would work only as a check on places already in the dataset: call Places API (New) Text Search with the stored name and address, compare the result's location (≤ 50 m) and name, keep `businessStatus` in memory only, store nothing but `xref.google_place_id`, and open a `conflict` item for a human when Google says `CLOSED_PERMANENTLY` or `CLOSED_TEMPORARILY` instead of changing the record. It would never be used for discovery or for any value.

## Blockers

- **Foursquare Open Source Places** is gated on Hugging Face. Using it needs an account that accepts the terms, which include letting Foursquare name the organisation in its marketing. That is a decision for the maintainers; then set `HF_TOKEN` and add a reader next to `agent/src/sources/overture.ts`.
- **Instagram** forbids automated collection; Instagram-only places can be found but their bios cannot be read.
- **Austria** needs an open municipal boundary file configured in `cities.json` (for example from Statistik Austria) before Austrian cities can run.
