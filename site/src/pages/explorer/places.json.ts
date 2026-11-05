// Everything the Explorer needs in one request: places with their city context.
import { places, version } from "../../lib/data";

export const GET = () => new Response(JSON.stringify({ version, places }), { headers: { "content-type": "application/json" } });
