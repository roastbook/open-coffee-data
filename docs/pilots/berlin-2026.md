# Berlin, November 2026

The second city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the [Munich pilot](munich-2026.md). The data is in [`datasets/coffee-places/de/berlin.json`](../../datasets/coffee-places/de/berlin.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset, like Munich.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 22 |
| Tier B (serves specialty) | 19 |
| none (no specialty evidence on its own site) | 655 |
| **Total** | **696**, all open |

99% have a street and postcode, 69% have opening hours (80% of tier A/B), 62% an Instagram link, 48% espresso and 10% filter coffee. 10 tier A/B places have all core fields (6 A, 4 B).

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary (BKG VG250) | 55,516 |
| In a coffee category, after dropping 68 closed, 173 clearly non-coffee or seasonal and duplicates | 2,770 |
| Candidates after web leads (223 places from 89 districts) | 2,910 |
| Stored: confirmed on their own website | 696 |

Overture licences in the city: CDLA-Permissive-2.0, Apache-2.0 (Foursquare) and CC0-1.0; none dropped. 62 candidates had no coordinates from any source and 32 conflicts (a website that gives another address, a dead website) are left for a human.

## How correct it is

Tier A/B decide what the dataset is for. A random sample of 60 places of the first complete pass (30 A, 15 B, 15 none), then all 89 A/B places of the second pass, then all 42 that are A or B now were audited against the pages the agent read, by independent reviewers. The first pass had 91 A and 29 B: most were a company's roastery elsewhere (a chain's roastery, "roasted in Berlin") counted as the café's own roasting. Two rule changes (own roasting must be shown for this place; a bare "Decaf" or "Filterkaffee" on a shop page is not a drink) cut A and B to 42, and the rule that the page must show this place's street to 41 (22 A, 19 B). The last audit still found wrong secondary values at about half of them.

Known and not fixed:

- roasting claims that name the roastery of another branch ("19grams Alex is our roastery") still pass for some branches when the quote sits on a page that lists all of them;
- hours that differ between two pages of one site, and hours from old blog posts;
- a chain's own site for a Berlin branch (Starbucks, Tchibo) brings the chain's Instagram and Facebook accounts, which can be another country's;
- menus that are only photos are transcribed, but a place whose pages are almost empty (Kairos Café, Cafe PiK) keeps values that could not be re-checked from text.

## Timing and cost

The first Berlin runs stalled twice on a hung browser or PDF step (they now have time limits), so total time and cost of the cold start were not measured. The pass that finished with warm caches took discovery 165 s, research 1,990 s, enrich 974 s; the passes with the new rules cost $16.10 and $1.71 in model calls.
