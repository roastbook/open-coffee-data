# Leipzig, November 2026

The seventh city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the earlier pilots ([Munich](munich-2026.md), [Berlin](berlin-2026.md), [Hamburg](hamburg-2026.md), [Köln](koeln-2026.md), [Frankfurt](frankfurt-2026.md), [Düsseldorf](duesseldorf-2026.md)). The data is in [`datasets/coffee-places/de/leipzig.json`](../../datasets/coffee-places/de/leipzig.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 1 |
| Tier B (serves specialty) | 1 |
| none (no specialty evidence on its own site) | 56 |
| **Total** | **58** |

All have a postcode, 76% have opening hours and 72% an Instagram link.

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary | 7,731 |
| In a coffee category, after dropping 5 closed, 24 clearly non-coffee or seasonal and duplicates | 242 |
| Candidates | 242 |
| Stored: confirmed on their own website | 58 |

No Overture licence was dropped. 9 candidates had no coordinates and 2 conflicts are left for a human. No web leads were found for Leipzig: the district list for the city is empty, so the candidates come from Overture alone. That is likely why the file is small, and the city should be re-run once its districts are configured.

## How correct it is

Not audited by independent reviewers yet. The two tier A/B places were only read as a list: BRÜHBAR states its own roasting, Café Fenchel Amadeus serves a named specialty roaster. The known problems of the Berlin pilot apply here too. Treat tier A/B as likely, not checked.

## Timing and cost

One pass took about 1.7 hours (research 5,570 s, enrich 680 s) and cost $15.03 in model calls.
