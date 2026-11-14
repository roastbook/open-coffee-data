# Dortmund, November 2026

The ninth city built with the data agent ([`docs/agent.md`](../agent.md)), against Overture release `2026-10-21.0`, with the rules from the earlier pilots ([Munich](munich-2026.md), [Berlin](berlin-2026.md), [Hamburg](hamburg-2026.md), [Köln](koeln-2026.md), [Frankfurt](frankfurt-2026.md), [Düsseldorf](duesseldorf-2026.md), [Leipzig](leipzig-2026.md), [Stuttgart](stuttgart-2026.md)). The data is in [`datasets/coffee-places/de/dortmund.json`](../../datasets/coffee-places/de/dortmund.json) (schema v0.3.0, licence CDLA-Permissive-2.0).

## What is in the file

Only places confirmed on their own website are in the dataset.

| | Places |
|---|---:|
| Tier A (specialty-focused) | 0 |
| Tier B (serves specialty) | 0 |
| none (no specialty evidence on its own site) | 43 |
| **Total** | **43** |

## How it was found

| | Count |
|---|---:|
| Overture places in the city boundary | 7,474 |
| In a coffee category, after dropping 4 closed, 17 clearly non-coffee or seasonal and duplicates | 226 |
| Candidates after web leads (17 places from 12 districts) | 231 |
| Stored: confirmed on their own website | 43 |

No Overture licence was dropped. 2 candidates had no coordinates. 42 pages were not fetched because the sites' access rules disallow it.

## How correct it is

Not audited by independent reviewers yet. Only 43 of 231 candidates were confirmed, and no place shows specialty evidence, so the file is small and has no tier A or B place. Dortmund should be re-run once more web leads are configured, and its tier none places should be read as "no specialty evidence found", not as "not specialty".

## Timing and cost

The first pass took about 2.6 hours (discovery 222 s, research 5,053 s, enrich 559 s) and cost $13.37 in model calls. The file was regenerated from the caches afterwards for $0.12.
