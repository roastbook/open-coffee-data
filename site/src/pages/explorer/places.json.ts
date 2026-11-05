// Everything the Explorer needs in one request: places (with city context) and source names.
import { places, sources, version } from "../../lib/data";

export const GET = () =>
  new Response(JSON.stringify({
    version,
    sources: Object.fromEntries(sources.sources.map((s: any) => [s.id, { name: s.name, licence: s.licence, attribution: s.attribution }])),
    places,
  }), { headers: { "content-type": "application/json" } });
