# Düsseldorf, November 2026

The sixth city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the earlier pilots ([Munich](munich-2026.md), [Berlin](berlin-2026.md), [Hamburg](hamburg-2026.md), [Köln](koeln-2026.md), [Frankfurt](frankfurt-2026.md)). The data is in [`datasets/coffee-places/de/duesseldorf.json`](../../datasets/coffee-places/de/duesseldorf.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 6 |
| Tier B (serves specialty) | 0 |
| none (no specialty evidence on its own site) | 105 |
| **Total** | **111** |

98% have a postcode, 66% have opening hours and 67% an Instagram link. No tier A/B place has all core fields.

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary | 12,477 |
| In a coffee category, after dropping 14 closed, 23 clearly non-coffee or seasonal and duplicates | 447 |
| Candidates after web leads (69 places from 48 districts) | 454 |
| Stored: confirmed on their own website | 111 |

No Overture licence was dropped. 25 candidates had no coordinates and 4 conflicts are left for a human.

## How correct it is

Not audited by independent reviewers yet. Tier A/B were only read as a list: three of the six tier A state their own roasting and three serve a named specialty roaster (MERCY coffee company has two branches on one website, Weird Space Café sells through a shop site). The known problems of the Berlin pilot apply here too (branch roasting claims, hours that differ between pages, a chain's social accounts from another country). Treat tier A/B as likely, not checked.

## Timing and cost

One pass took about 3.5 hours (discovery 648 s, research 10,619 s, enrich 1,219 s) and cost $32.89 in model calls.
