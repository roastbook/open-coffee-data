# Hamburg, November 2026

The third city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the [Munich](munich-2026.md) and [Berlin](berlin-2026.md) pilots. The data is in [`datasets/coffee-places/de/hamburg.json`](../../datasets/coffee-places/de/hamburg.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 14 |
| Tier B (serves specialty) | 5 |
| none (no specialty evidence on its own site) | 323 |
| **Total** | **342** |

98% have a street and postcode, 63% have opening hours and 66% an Instagram link. 4 tier A/B places have all core fields.

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary | 29,969 |
| In a coffee category, after dropping 25 closed, 73 clearly non-coffee or seasonal and duplicates | 1,200 |
| Candidates after web leads (157 places from 104 districts) and Wikidata | 1,243 |
| Stored: confirmed on their own website | 342 |

No Overture licence was dropped. 33 candidates had no coordinates and 11 conflicts are left for a human.

## How correct it is

Not audited by independent reviewers yet. The first pass listed a chain (Espresso House) as tier A or B in four places; it is now on the chain list and counts as none, which took A/B from 24 to 19. The known problems of the Berlin pilot apply here too: roasting claims for branches whose page lists several addresses, hours that differ between pages, and a chain's social accounts from another country. Treat tier A/B as likely, not checked.

## Timing and cost

The first pass took about 9 hours (research 29,665 s, enrich 3,479 s) and cost $79.15 in model calls; the re-check with the chain rule took 1 hour and cost $6.22.
