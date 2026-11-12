# Frankfurt am Main, November 2026

The fifth city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the earlier pilots ([Munich](munich-2026.md), [Berlin](berlin-2026.md), [Hamburg](hamburg-2026.md), [Köln](koeln-2026.md)). The data is in [`datasets/coffee-places/de/frankfurt-am-main.json`](../../datasets/coffee-places/de/frankfurt-am-main.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 2 |
| Tier B (serves specialty) | 4 |
| none (no specialty evidence on its own site) | 162 |
| **Total** | **168** |

95% have a postcode, 68% have opening hours and 58% an Instagram link.

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary | 13,477 |
| In a coffee category, after dropping 28 closed, 38 clearly non-coffee or seasonal and duplicates | 641 |
| Candidates after web leads (71 places from 16 districts) | 656 |
| Stored: confirmed on their own website | 168 |

No Overture licence was dropped. 14 candidates had no coordinates and 5 conflicts are left for a human.

## How correct it is

Not audited by independent reviewers yet. Six tier A/B places remain (one, Café Wacker Grüneburgweg, was corrected to none because its coffee is roasted at the company's roastery in Fechenheim). One tier B place (Italienische Feinkost 2000) has no street address. The known problems of the Berlin pilot apply here too (branch roasting claims, hours that differ between pages, a chain's social accounts from another country). Treat tier A/B as likely, not checked.

## Timing and cost

One pass took about 5 hours (discovery 443 s, research 15,077 s, enrich 1,709 s) and cost $41.57 in model calls.
