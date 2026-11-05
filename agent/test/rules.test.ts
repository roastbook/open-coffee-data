import { expect, test } from "bun:test";
import { parseRules } from "../src/pages";

test("site rules: our group wins over *, longest match wins, Allow wins ties", () => {
  const r = parseRules(`User-agent: *\nDisallow: /\n\nUser-agent: RoastbookOpenCoffee\nDisallow: /private/\nAllow: /private/menu\nDisallow: /*.pdf$\n`);
  expect(r.allowed("https://x.example/")).toBe(true);
  expect(r.allowed("https://x.example/private/a")).toBe(false);
  expect(r.allowed("https://x.example/private/menu")).toBe(true);
  expect(r.allowed("https://x.example/karte.pdf")).toBe(false);
  expect(r.allowed("https://x.example/karte.pdf?x=1")).toBe(true);
});

test("site rules: falls back to *, shared groups and empty Disallow", () => {
  const all = parseRules("User-agent: Googlebot\nUser-agent: *\nDisallow: /admin\n");
  expect(all.allowed("https://x.example/admin/x")).toBe(false);
  expect(all.allowed("https://x.example/kontakt")).toBe(true);
  expect(parseRules("User-agent: *\nDisallow:\n").allowed("https://x.example/a")).toBe(true);
  expect(parseRules("User-agent: *\nDisallow: /\n").allowed("https://x.example/a")).toBe(false);
  expect(parseRules("").allowed("https://x.example/a")).toBe(true);
});
