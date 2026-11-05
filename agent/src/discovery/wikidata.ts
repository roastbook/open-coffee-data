// Wikidata (CC0): cafés and coffee houses (instances of a subclass of Q30022) in the city's bounding box, with website and image.
import { USER_AGENT } from "../config";

export type WikidataPlace = { qid: string; name: string; lat: number; lon: number; website?: string; image?: string; closed: boolean };

export async function wikidataCafes(bb: { xmin: number; ymin: number; xmax: number; ymax: number }): Promise<WikidataPlace[]> {
  const q = `SELECT ?p ?pLabel ?coord ?site ?img ?end WHERE {
    SERVICE wikibase:box { ?p wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${bb.xmin} ${bb.ymin})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${bb.xmax} ${bb.ymax})"^^geo:wktLiteral. }
    ?p wdt:P31 ?type. ?type wdt:P279* wd:Q30022.
    OPTIONAL { ?p wdt:P856 ?site } OPTIONAL { ?p wdt:P18 ?img } OPTIONAL { ?p wdt:P576 ?end } OPTIONAL { ?p wdt:P3999 ?end }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". } }`;
  const res = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(q), { headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const rows = (await res.json() as any).results.bindings;
  const out = new Map<string, WikidataPlace>();
  for (const b of rows) {
    const qid = b.p.value.split("/").pop();
    const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!m || out.has(qid)) continue;
    out.set(qid, { qid, name: b.pLabel.value, lon: +m[1], lat: +m[2], website: b.site?.value, image: b.img?.value, closed: !!b.end });
  }
  return [...out.values()];
}
