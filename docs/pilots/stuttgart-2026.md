# Stuttgart, November 2026

The eighth city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the earlier pilots ([Munich](munich-2026.md), [Berlin](berlin-2026.md), [Hamburg](hamburg-2026.md), [Köln](koeln-2026.md), [Frankfurt](frankfurt-2026.md), [Düsseldorf](duesseldorf-2026.md), [Leipzig](leipzig-2026.md)). The data is in [`datasets/coffee-places/de/stuttgart.json`](../../datasets/coffee-places/de/stuttgart.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 1 |
| Tier B (serves specialty) | 2 |
| none (no specialty evidence on its own site) | 72 |
| **Total** | **75** |

97% have a postcode, 77% have opening hours and 67% an Instagram link. 2 tier A/B places have all core fields.

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary | 9,332 |
| In a coffee category, after dropping 3 closed, 21 clearly non-coffee or seasonal and duplicates | 347 |
| Candidates after web leads (41 places from 22 districts) | 358 |
| Stored: confirmed on their own website | 75 |

No Overture licence was dropped. 15 candidates had no coordinates and 2 conflicts are left for a human.

## How correct it is

Not audited by independent reviewers yet. The three tier A/B places were only read as a list: Kaffeerakete states its own roasting, wylđ serves a named specialty roaster, and abnorm concept space is tier B without a roasting claim. The known problems of the Berlin pilot apply here too. Treat tier A/B as likely, not checked.

## Timing and cost

One pass took about 2.7 hours (discovery 327 s, research 8,556 s, enrich 993 s) and cost $22.79 in model calls.
