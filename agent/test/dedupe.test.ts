import { expect, test } from "bun:test";
import type { Candidate } from "../src/candidate";
import { dedupe, samePlace } from "../src/dedupe";
import { nameSim, parseStreet, sameStreet } from "../src/names";

const c = (name: string, extra: Partial<Candidate> = {}): Candidate => ({ key: name, name, overtureIds: [], roasters: [], origins: [], ...extra });

test("name similarity ignores generic words", () => {
  expect(nameSim("Man Versus Machine Coffee Roasters", "Man Versus Machine")).toBe(1);
  expect(nameSim("Café Frischhut", "Schmalznudel Cafe Frischhut")).toBeGreaterThanOrEqual(0.85);
  expect(nameSim("Café Luitpold", "Café Stefanie")).toBeLessThan(0.5);
});

test("streets compare across spellings and abbreviations", () => {
  expect(sameStreet("Müllerstr. 23", "Müllerstraße 23")).toBe(true);
  expect(sameStreet("Müllerstrasse 23", "Müllerstraße 23")).toBe(true);
  expect(sameStreet("Müllerstraße 23", "Müllerstraße 25")).toBe(false);
  expect(parseStreet("Türkenstraße 52a")).toEqual({ street: "turkenstrasse", number: "52a" });
});

test("same place: close and similar, same address, or same site at the same spot", () => {
  const a = c("Vits der Kaffee", { lat: 48.1500, lon: 11.5800, street: "Rumfordstraße 49" });
  expect(samePlace(a, c("VITS Kaffee", { lat: 48.1503, lon: 11.5801 }))).toBe(true);
  expect(samePlace(a, c("Vits der Kaffee", { lat: 48.1600, lon: 11.5800 }))).toBe(false); // 1.1 km away
  expect(samePlace(a, c("Vits", { street: "Rumfordstr. 49" }))).toBe(true);
  // One website, two branches at different addresses: not the same place.
  const b1 = c("The Barn Altstadt", { lat: 48.137, lon: 11.575, street: "Sendlinger Str. 1", website: "https://thebarn.de/" });
  const b2 = c("The Barn Glockenbach", { lat: 48.130, lon: 11.570, street: "Müllerstraße 2", website: "https://thebarn.de/" });
  expect(samePlace(b1, b2)).toBe(false);
});

test("dedupe merges duplicates and keeps the first record's values", () => {
  const out = dedupe([
    c("Café Kosmos", { lat: 48.14, lon: 11.56, overtureIds: ["a"], website: "https://kosmos.example/" }),
    c("Kosmos Cafe", { lat: 48.1401, lon: 11.5601, overtureIds: ["b"], instagram: "https://www.instagram.com/kosmos/" }),
    c("Bäckerei Kosmos", { lat: 48.15, lon: 11.56, overtureIds: ["c"] }),
  ]);
  expect(out).toHaveLength(2);
  expect(out[0].overtureIds).toEqual(["a", "b"]);
  expect(out[0].website).toBe("https://kosmos.example/");
  expect(out[0].instagram).toBe("https://www.instagram.com/kosmos/");
});
