import { expect, test } from "bun:test";
import { listsPartner, namesPlace } from "../src/research";

const c: any = { name: "Café Kosmos", street: "Dachauer Straße 7", overtureIds: [], roasters: [], origins: [] };

test("a page names the place only with its distinctive name and its street or city", () => {
  expect(namesPlace("Unsere Partner: Café Kosmos, Dachauer Str. 7", c, "München")).toBe(true);
  expect(namesPlace("Kosmos Bar in München", c, "München")).toBe(true);
  expect(namesPlace("Kosmos coffee blend 250 g", c, "München")).toBe(false);
  expect(namesPlace("Café Luna, Dachauer Straße 7, München", c, "München")).toBe(false);
});

test("a roastery page counts only when it presents the place as partner, stockist or own café", () => {
  expect(listsPartner("Hier gibt es unseren Kaffee – unsere Partner in München: Café Kosmos, Bar Luna", c, "https://roast.example/")).toBe(true);
  expect(listsPartner("Café Kosmos", c, "https://roast.example/pages/stockists")).toBe(true);
  expect(listsPartner("Gestern waren wir im Café Kosmos und haben Kuchen gegessen. " + "x ".repeat(400) + " Unsere Partner", c, "https://roast.example/blog/1")).toBe(false);
});
