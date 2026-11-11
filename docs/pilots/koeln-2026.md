# Köln, November 2026

The fourth city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the [Munich](munich-2026.md), [Berlin](berlin-2026.md) and [Hamburg](hamburg-2026.md) pilots. The data is in [`datasets/coffee-places/de/koeln.json`](../../datasets/coffee-places/de/koeln.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 4 |
| Tier B (serves specialty) | 3 |
| none (no specialty evidence on its own site) | 175 |
| **Total** | **182** |

98% have a street and postcode, 69% have opening hours and 69% an Instagram link. No tier A/B place has all core fields.

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary | 18,414 |
| In a coffee category, after dropping 38 closed, 36 clearly non-coffee or seasonal and duplicates | 687 |
| Candidates after web leads (108 places from 73 districts) and Wikidata | 700 |
| Stored: confirmed on their own website | 182 |

No Overture licence was dropped. 33 candidates had no coordinates and 9 conflicts are left for a human.

## How correct it is

Not audited by independent reviewers yet. The seven tier A/B places were only read as a list: the four tier A all state their own roasting, the three tier B name a specialty roaster. The known problems of the Berlin pilot apply here too (branch roasting claims, hours that differ between pages, a chain's social accounts from another country). Treat tier A/B as likely, not checked.

## Timing and cost

One pass took about 5 hours (discovery 1,004 s, research 15,948 s, enrich 1,888 s) and cost $48.49 in model calls.
