import { expect, test } from "bun:test";
import {
  cafeBindings,
  districtBindings,
  modelReply,
  ownSites,
  placeLeads,
  searchReply,
} from "../src/network-payloads";
import { htmlToDoc, htmlGeo } from "../src/html";
import { bbox, inPolygons, toPolygons } from "../src/geo";
import { parseRules, pool, ruleMatches } from "../src/pages";
import { cost } from "../src/llm";

test("provider payloads reject malformed fields while allowing unknown API metadata", () => {
  expect(
    modelReply({
      usage: { prompt_tokens: 12 },
      choices: [{ message: { content: "coffee" } }],
      id: "provider-id",
    }).choices?.[0].message?.content,
  ).toBe("coffee");
  expect(
    modelReply({
      output: [
        { type: "web_search_call", id: "search-1" },
        { type: "message", content: [{ text: "found" }] },
      ],
    }).output,
  ).toHaveLength(2);
  expect(() => modelReply({ usage: { prompt_tokens: "12" } })).toThrow(
    "Invalid payload",
  );
  expect(() =>
    modelReply({ choices: [{ message: { content: { html: "bad" } } }] }),
  ).toThrow();
  expect(searchReply({ results: [null, { title: "missing URL" }, { url: "https://valid.example" }] }).results).toEqual([{ url: "https://valid.example" }]);
  expect(
    searchReply({
      web: { results: [{ url: "https://cafe.example", description: "café" }] },
    }).web?.results?.[0].description,
  ).toBe("café");
  expect(ownSites({ own_site: [42, "https://valid.example"] }).own_site).toEqual(["https://valid.example"]);
  expect(placeLeads({ places: [null, { name: ["bad"] }, { name: "Valid", website: "https://valid.example" }] }).places).toEqual([{ name: "Valid", website: "https://valid.example" }]);
  expect(() => placeLeads({ error: "not a leads reply" })).toThrow();
});

test("Wikidata bindings validate required values and optional source fields", () => {
  const binding = {
    p: { value: "https://www.wikidata.org/entity/Q1" },
    pLabel: { value: "Café" },
    coord: { value: "Point(11.5 48.1)" },
  };
  expect(
    cafeBindings({ results: { bindings: [binding] } }).results.bindings[0]
      .pLabel.value,
  ).toBe("Café");
  expect(() =>
    cafeBindings({
      results: { bindings: [{ ...binding, coord: { value: 42 } }] },
    }),
  ).toThrow();
  expect(() =>
    districtBindings({ results: { bindings: [{ d: { value: "Q1" } }] } }),
  ).toThrow();
});

test("HTML extraction keeps page facts and skips broken resource URLs", () => {
  const doc = htmlToDoc(
    `<!doctype html><title>Café</title><p>Äpfel &amp; &ouml;l &#x110000;</p><a href="/menu">Menu</a><a href="http://[">broken</a><img src="/menu.jpg" alt="Drinks"><img src="http://["><script type="application/json">{"nested":["Filter coffee","https://ignored.example","/asset.js",42]}</script><script>alert('no')</script>`,
    "https://cafe.example/",
  );
  expect(doc.links).toEqual([
    { href: "https://cafe.example/menu", text: "Menu" },
  ]);
  expect(doc.images).toEqual([
    { href: "https://cafe.example/menu.jpg", text: "Drinks" },
  ]);
  expect(doc.text).toContain("Äpfel & öl &#x110000;");
  expect(doc.text).toContain("Filter coffee");
  expect(doc.text).not.toContain("alert");
  expect(doc.text).not.toContain("ignored.example");
  expect(
    htmlGeo(
      `<meta name="geo.position" content="48.1234;11.5678"><div data-lat="48.2345" data-lon="11.6789"></div>L.marker([48.3456,11.7890])`,
    ),
  ).toEqual([
    { lat: 48.1234, lon: 11.5678 },
    { lat: 48.2345, lon: 11.6789 },
    { lat: 48.3456, lon: 11.789 },
  ]);
});

test("GeoJSON boundaries accept collections and holes, reject nonnumeric coordinates", () => {
  const coordinates = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [2, 2],
      [3, 2],
      [3, 3],
      [2, 3],
      [2, 2],
    ],
  ];
  const polys = toPolygons({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Polygon", coordinates } }],
  });
  expect(inPolygons(polys, { lat: 1, lon: 1 })).toBe(true);
  expect(inPolygons(polys, { lat: 2.5, lon: 2.5 })).toBe(false);
  expect(bbox(polys)).toEqual({ xmin: 0, ymin: 0, xmax: 10, ymax: 10 });
  expect(
    toPolygons({ type: "MultiPolygon", coordinates: [coordinates] }),
  ).toEqual(polys);
  expect(() =>
    toPolygons({ type: "Polygon", coordinates: [[["0", 0]]] }),
  ).toThrow();
});

test("robots wildcards preserve literal punctuation, anchoring and tie precedence", () => {
  expect(ruleMatches("/a.b$", "/axb")).toBe(false);
  expect(ruleMatches("/a.b$", "/a.b")).toBe(true);
  expect(ruleMatches("/a**b*c$", "/abbc")).toBe(true);
  expect(ruleMatches("/a*b$", "/ab?x")).toBe(false);
  expect(ruleMatches("/a*b", "/ab?x")).toBe(true);
  expect(ruleMatches("/a*a$", "/a")).toBe(false);
  expect(ruleMatches("/a*a$", "/aa")).toBe(true);
  expect(ruleMatches("/*".repeat(500) + "missing$", "/".repeat(10000))).toBe(
    false,
  );
  const rules = parseRules(
    "User-agent: *\nDisallow: /x\nAllow: /x\nDisallow: /a.b$\n",
  );
  expect(rules.allowed("https://cafe.example/x")).toBe(true);
  expect(rules.allowed("https://cafe.example/axb")).toBe(true);
  expect(rules.allowed("https://cafe.example/a.b")).toBe(false);
});

test("bounded task pool preserves input order", async () => {
  let active = 0,
    peak = 0;
  const result = await pool([1, 2, 3, 4], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await Bun.sleep(5 - value);
    active--;
    return value * 2;
  });
  expect(result).toEqual([2, 4, 6, 8]);
  expect(peak).toBe(2);
  expect(await pool([], 2, async (value: number) => value)).toEqual([]);
});

test("model names matching Object prototype keys use fallback prices", () => {
  expect(cost("__proto__", 1_000_000, 0)).toBe(
    cost("unknown-model", 1_000_000, 0),
  );
  expect(cost("constructor", 0, 1_000_000)).toBe(
    cost("unknown-model", 0, 1_000_000),
  );
});
