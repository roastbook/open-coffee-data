import { expect, test } from "bun:test";
import { findQuote, norm } from "../src/evidence";
import { verify, type Proposal } from "../src/extract";
import { pickImages, type SitePage } from "../src/site";

const page = (text: string, url = "https://cafe.example/"): SitePage => ({ url, fetchedAt: "2026-11-05T10:00:00Z", rendered: false, doc: { title: "", text, links: [], jsonld: "" } });

test("quotes match across whitespace, dashes and case, but not when altered", () => {
  const text = "Öffnungszeiten\nMo – Fr 8–18 Uhr\nWir rösten   selbst.";
  expect(findQuote(text, "Mo - Fr 8-18 Uhr")).toBeGreaterThanOrEqual(0);
  expect(findQuote(text, "wir rösten selbst")).toBeGreaterThanOrEqual(0);
  expect(findQuote(text, "Mo – Fr 8–19 Uhr")).toBe(-1);
  expect(findQuote(text, "ok")).toBe(-1); // too short to count
  expect(norm("A­B​C")).toBe("abc");
  // Lines joined by the model still match, at the right position; altered text still does not.
  const t2 = "Intro\nDas VILLAGE ist geöffnet.\nAuch Kaffee";
  expect(findQuote(t2, "Das VILLAGE ist geöffnet.Auch Kaffee")).toBe(norm(t2).indexOf("das village"));
  expect(findQuote(t2, "Das VILLAGE ist geschlossen.Auch Kaffee")).toBe(-1);
});

test("verify keeps only quoted, field-relevant values", () => {
  const p = [page("Öffnungszeiten: Mo–Fr 8–18 Uhr\nFilterkaffee aus der V60\nKein WLAN\nWir lieben Kuchen.\nImpressum: Bohne & Co. GmbH, HRB 123456\nInhaber Max Muster e.K.", "https://cafe.example/impressum")];
  const props: Proposal[] = [
    { field: "opening_hours", value: "Mo-Fr 08:00-18:00", page: 1, quote: "Mo–Fr 8–18 Uhr" },
    { field: "serving.filter", value: true, page: 1, quote: "Filterkaffee aus der V60" },
    { field: "serving.pour_over", value: true, page: 1, quote: "Filterkaffee aus der V60" },
    { field: "amenities.wifi", value: false, page: 1, quote: "Kein WLAN" },
    { field: "serving.espresso", value: true, page: 1, quote: "Wir lieben Kuchen." }, // quote does not mention espresso
    { field: "food.cakes_baked_in_house", value: true, page: 1, quote: "Wir lieben Kuchen." }, // no "baked in house"
    { field: "serving.cold_brew", value: true, page: 1, quote: "Cold Brew jeden Tag" }, // not on the page
    { field: "amenities.dogs_allowed", value: false, page: 1, quote: "Filterkaffee aus der V60" }, // false without negation
    { field: "operator", value: "Bohne & Co. GmbH", page: 1, quote: "Bohne & Co. GmbH" },
    { field: "operator", value: "Max Muster e.K.", page: 1, quote: "Max Muster e.K." }, // natural person
    { field: "register_id", value: "HRB 123456", page: 1, quote: "HRB 123456" },
    { field: "opening_hours", value: "Mo-Fr 08:00-20:00", page: 2, quote: "Mo–Fr 8–18 Uhr" }, // no page 2
  ];
  const { kept, rejected } = verify(props, p, { country: "DE", ownName: "Bohne", multiLocation: false });
  const got = Object.fromEntries(kept.map((k) => [k.field, k.value]));
  expect(got).toEqual({ opening_hours: "Mo-Fr 08:00-18:00", "serving.filter": true, "serving.pour_over": true, "amenities.wifi": false, operator: "Bohne & Co. GmbH", register_id: "HRB 123456" });
  expect(rejected.map((r) => r.reason)).toContain("quote not on page");
  expect(rejected.map((r) => r.reason)).toContain("not a legal entity");
});

test("contradicting values for one field cancel out", () => {
  const p = [page("Espresso to go. Wir haben keinen Espresso mehr.")];
  const { kept } = verify([
    { field: "serving.espresso", value: true, page: 1, quote: "Espresso to go" },
    { field: "serving.espresso", value: false, page: 1, quote: "keinen Espresso" },
  ], p, { country: "DE", ownName: "x", multiLocation: false });
  expect(kept).toHaveLength(0);
});

test("on multi-location sites, hours must sit near this location's street", () => {
  const filler = "x ".repeat(800);
  const p = [page(`Schwabing: Leopoldstraße 10, 80802 München. Mo–Fr 7–19 Uhr. ${filler} Maxvorstadt: Türkenstraße 5, 80799 München. Mo–Fr 9–17 Uhr.`)];
  const prop: Proposal[] = [{ field: "opening_hours", value: "Mo-Fr 07:00-19:00", page: 1, quote: "Mo–Fr 7–19 Uhr" }];
  expect(verify(prop, p, { street: "Leopoldstraße 10", country: "DE", ownName: "x", multiLocation: true }).kept).toHaveLength(1);
  expect(verify(prop, p, { street: "Türkenstraße 5", country: "DE", ownName: "x", multiLocation: true }).kept).toHaveLength(0);
});

import { placeWordsFrom, siteMatches } from "../src/extract";

test("siteMatches: districts, streets, cities and generic words never identify a place", () => {
  const pg = (text: string, title = "") => [{ url: "https://mvsm.coffee/pages/locations", fetchedAt: "", rendered: false, doc: { title, text, links: [], jsonld: "" } }];
  const words = placeWordsFrom(["München", "Schwabing-West", "Maxvorstadt", "Gärtnerplatz 6", "Reichenbachstraße 5", "Schellingstr. 133"]);
  const locations = pg("Our cafés: Schwabing, Schellingstr. 133, 80799 München. Gärtnerplatz, Reichenbachstraße 5, 80469 München. Geöffnet ab Mai.");
  // Wrong matches seen in Munich: a district, a square, a month.
  expect(siteMatches(locations, { name: "Naturkosmetik Schwabing", street: "Schellingstr. 133" }, "mvsm.coffee", words).ok).toBe(false);
  expect(siteMatches(locations, { name: "Mai Asia In München-schwabing", street: "Schellingstr. 133" }, "mvsm.coffee", words).ok).toBe(false);
  expect(siteMatches(locations, { name: "Cafe Kiosk Am Gärtnerplatz", street: "Reichenbachstraße 25" }, "sweetspotkaffee.de", words).ok).toBe(false);
  expect(siteMatches(pg("Aroma ist uns wichtig. Pestalozzistr. 24"), { name: "Aroma Kaffeebar", street: "Pestalozzistr. 24" }, "luffy-pancake.com", words).ok).toBe(false);
  expect(siteMatches(pg("Kaffee Service für Büros, Feldmochinger Straße 384"), { name: "S & S Kaffee Service", street: "Feldmochinger Straße 384" }, "coffee-feeling.com", words).ok).toBe(false);
  // Right matches: a distinctive word in the domain, the whole name, or two distinctive words.
  expect(siteMatches(pg("Willkommen! Schellingstr. 133"), { name: "Man Versus Machine", street: "Schellingstr. 133" }, "mvsm.coffee", words).ok).toBe(false);
  expect(siteMatches(pg("Man versus Machine Coffee Roasters, Schellingstr. 133"), { name: "Man Versus Machine", street: "Schellingstr. 133" }, "mvsm.coffee", words).ok).toBe(true);
  expect(siteMatches(pg("Kaffee und Kuchen, Lilienstraße 34", "Café Blá"), { name: "Café Blá", street: "Lilienstraße 34" }, "cafebla.de", words).ok).toBe(true);
  expect(siteMatches(pg("Aroma Kaffeebar – Pestalozzistr. 24"), { name: "Aroma Kaffeebar", street: "Pestalozzistr. 24" }, "aroma-kaffeebar.de", words).ok).toBe(true);
});

test("evidence regexes: negations, Speisekarte, Hotdog, supplier roasters, bare weights", () => {
  const one = (field: any, value: any, quote: string) => verify([{ field, value, page: 1, quote }], [page(quote)], { country: "DE", ownName: "x", multiLocation: false }).kept.length;
  expect(one("amenities.wifi", true, "Kein WLAN vorhanden")).toBe(0);
  expect(one("amenities.dogs_allowed", true, "Hunde sind nicht erlaubt")).toBe(0);
  expect(one("amenities.outdoor_seating", true, "Leider ohne Terrasse")).toBe(0);
  expect(one("amenities.wifi", false, "Kein WLAN vorhanden")).toBe(1);
  expect(one("amenities.card_payment", true, "Unsere Speisekarte als PDF")).toBe(0);
  expect(one("amenities.card_payment", true, "Wir akzeptieren EC-Karte und Kreditkarte")).toBe(1);
  expect(one("amenities.dogs_allowed", true, "Hotdog mit Röstzwiebeln")).toBe(0);
  expect(one("amenities.dogs_allowed", true, "Hunde sind willkommen")).toBe(1);
  expect(one("roasts_own_beans", true, "Wir servieren Kaffee von der Rösterei Vits")).toBe(0);
  expect(one("roasts_own_beans", true, "Unseren Kaffee rösten wir selbst in Giesing")).toBe(1);
  expect(one("roasts_own_beans", true, "We use a LORING roaster and build individual profiles")).toBe(1);
  expect(one("roasts_own_beans", true, "Erstklassiger Kaffee, geröstet von Johannes Bayer")).toBe(0);
  expect(one("roasts_own_beans", true, "Roasted for espresso by Pacanda Kaffeerösterei")).toBe(0);
  expect(one("serving.decaf", true, "Decaf Espresso · 500 g Calma")).toBe(0);
  expect(one("serving.filter", true, "Filterkaffee gemahlen für Siebträger")).toBe(0);
  expect(one("serving.cold_brew", true, "Cold Brew (seasonal)")).toBe(0);
  expect(one("serving.decaf", true, "Kaffee auch entkoffeiniert +0,30")).toBe(1);
  expect(one("roasts_own_beans", true, "Wir haben unsere eigene „Espresso Feel Good“-Röstung entwickelt")).toBe(0);
  expect(one("sells_beans", true, "Bowl mit Lachs 250 g")).toBe(0);
  expect(one("sells_beans", true, "Espresso Blend 250 g zum Mitnehmen")).toBe(1);
  expect(one("sells_beans", true, "Ganze Bohnen für zu Hause")).toBe(1);
});

import { htmlGeo } from "../src/html";
import { siteGeo } from "../src/pipeline";
test("coordinates a site publishes itself, never Google's", () => {
  expect(htmlGeo(`<script type="application/ld+json">{"geo":{"latitude":48.13512,"longitude":11.58198}}</script>`)).toEqual([{ lat: 48.13512, lon: 11.58198 }]);
  expect(htmlGeo(`<meta name="geo.position" content="48.1351; 11.5820">`)).toEqual([{ lat: 48.1351, lon: 11.582 }]);
  expect(htmlGeo(`<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=11.5,48.1,11.6,48.2&marker=48.13512%2C11.58198">`)).toEqual([{ lat: 48.13512, lon: 11.58198 }]);
  expect(htmlGeo(`L.marker([48.13512, 11.58198]).addTo(map)`)).toEqual([{ lat: 48.13512, lon: 11.58198 }]);
  expect(htmlGeo(`<iframe src="https://www.google.com/maps/embed?pb=!1m18!3d48.13512!2d11.58198">`)).toEqual([]);
  const page = (geo: any[]) => ({ url: "https://x.example/", doc: { geo } });
  expect(siteGeo([page([{ lat: 48.13512, lon: 11.58198 }]), page([{ lat: 48.13513, lon: 11.58199 }])])).toMatchObject({ lat: 48.13512 });
  expect(siteGeo([page([{ lat: 48.13512, lon: 11.58198 }, { lat: 48.16, lon: 11.6 }])])).toBeNull(); // several locations
});

import { addressPoint } from "../src/pipeline";
test("a confirmed address takes the building position from another Overture record there", () => {
  const pts = [
    { id: "a", street: "Türkenstraße 52", postcode: "80799", lat: 48.1500, lon: 11.5800 },
    { id: "b", street: "Türkenstr. 52", postcode: "80799", lat: 48.15005, lon: 11.58003 },
    { id: "c", street: "Türkenstraße 54", postcode: "80799", lat: 48.1510, lon: 11.5800 },
  ];
  expect(addressPoint(pts, "Türkenstraße 52", "80799")).toMatchObject({ lat: 48.15 });
  expect(addressPoint(pts, "Türkenstraße 52", "80333")).toBeNull(); // other postcode
  expect(addressPoint(pts, "Türkenstraße", "80799")).toBeNull(); // no house number
  expect(addressPoint([...pts, { id: "d", street: "Türkenstraße 52", postcode: "80799", lat: 48.16, lon: 11.58 }], "Türkenstraße 52", "80799")).toBeNull(); // records disagree
});

test("multi-branch sites: what a neutral menu page serves holds for every branch; hours still need the branch address", () => {
  const pages = [page("Wir servieren Filterkaffee aus der V60 und Espresso."), page(`Sendlinger Str. 1, 80331 München. Mo–Fr 8–18 Uhr. ${"x ".repeat(800)} Reichenbachstr. 38, 80469 München. Mo–Fr 9–17 Uhr.`)];
  const props: Proposal[] = [
    { field: "serving.filter", value: true, page: 1, quote: "Filterkaffee aus der V60" },
    { field: "amenities.wifi", value: true, page: 1, quote: "Filterkaffee aus der V60" },
    { field: "opening_hours", value: "Mo-Fr 08:00-18:00", page: 2, quote: "Mo–Fr 8–18 Uhr" },
  ];
  const kept = verify(props, pages, { street: "Reichenbachstr. 38", postcode: "80469", country: "DE", ownName: "x", multiLocation: true }).kept.map((k) => k.field);
  expect(kept).toEqual(["serving.filter"]); // wifi quote does not mention it; the 8-18 hours belong to the other branch
});

test("siteMatches: taglines, museum cafés and street spellings", () => {
  const pg = (text: string, title = "") => [{ url: "https://x.example/", fetchedAt: "", rendered: false, doc: { title, text, links: [], jsonld: "" } }];
  const words = placeWordsFrom(["München", "Brandhorst", "Hohenzollernstraße 59", "Bahnhofpl. 1"]);
  expect(siteMatches(pg("The Spirited Goat, Hohenzollernstraße 59, 80796 München"), { name: "The Spirited Goat - Specialty Coffee", street: "Hohenzollernstraße 59" }, "thespiritedgoat.de", words).ok).toBe(true);
  expect(siteMatches(pg("Café | Museum Brandhorst. Theresienstraße 35A 80333 München", "Café | Museum Brandhorst"), { name: "Café Im Museum Brandhorst", postcode: "80333" }, "museum-brandhorst.de", words).ok).toBe(true);
  expect(siteMatches(pg("O Caffè Mio, Bahnhofsplatz 1-3 (Zwischengeschoss) München"), { name: "O Caffè Mio", street: "Bahnhofpl. 1 - 3/Im Untergeschoss" }, "ocaffemio.de", words).ok).toBe(true);
});

import { keywordProposals } from "../src/extract";
test("keyword pass: menu lines become checked proposals; negated lines are rejected", () => {
  const pages = [page("KAFFEE\nEspresso 2,50\nAufpreis Hafermilch +0,30 €\nalle Kaffees auch entkoffeiniert\nKein WLAN\nAußenbereich nicht reservierbar, Terrasse ab 10 Uhr")];
  const props = keywordProposals(pages);
  const kept = verify(props, pages, { country: "DE", ownName: "x", multiLocation: false }).kept.map((k) => k.field).sort();
  expect(kept).toEqual(["amenities.outdoor_seating", "serving.decaf", "serving.espresso", "serving.plant_milk"]);
});

test("menu photos: named menus first, then images on a menu page; logos and other pages skipped", () => {
  const withImages = (url: string, images: { href: string; text: string }[]): SitePage => ({ ...page("", url), doc: { title: "", text: "", links: [], jsonld: "", images } });
  const picked = pickImages([
    withImages("https://cafe.example/", [{ href: "https://cafe.example/logo.png", text: "Speisekarte" }, { href: "https://cafe.example/team.jpg", text: "" }, { href: "https://static.wixstatic.com/media/a.jpg", text: "Getränkekarte" }]),
    withImages("https://cafe.example/speisekarte", [{ href: "https://cafe.example/p1.jpg", text: "" }]),
  ]);
  expect(picked).toEqual(["https://static.wixstatic.com/media/a.jpg", "https://cafe.example/p1.jpg"]);
});

test("a name made only of district words does not match a site that merely mentions the district", () => {
  const words = placeWordsFrom(["München", "Schwabing", "Belgradstraße 1"]);
  const site = [{ url: "https://cafeneuhauser.de/", fetchedAt: "", rendered: false, doc: { title: "Café Neuhauser - Neuhausen, Schwabing & Gärtnerplatz", text: "Schwabing Belgradstraße 1 | 80796 München", links: [], jsonld: "" } }];
  expect(siteMatches(site, { name: "Café Schwabing", street: "Belgradstraße 1" }, "cafeneuhauser.de", words).ok).toBe(false);
});

test("serving facts: not from shop or wiki pages, allergen keys, dishes or teas", () => {
  const ctx = { country: "DE", ownName: "Café X", multiLocation: false };
  const one = (field: Proposal["field"], quote: string, url = "https://cafe.example/karte") => verify([{ field, value: true, page: 1, quote }], [page(quote, url)], ctx).kept.length;
  expect(one("serving.plant_milk", "Hafermilch +0,50")).toBe(1);
  expect(one("roasts_own_beans", "Wir sind eine Gourmet Kaffeerösterei", "https://cafe.example/karte.pdf")).toBe(0);
  expect(one("roasts_own_beans", "Unseren Kaffee rösten wir selbst", "https://cafe.example/karte.pdf")).toBe(1);
  expect(one("serving.plant_milk", "Allergene: Gluten (Weizen, Hafer), Soja")).toBe(0);
  expect(one("serving.plant_milk", "Thai-Curry mit Kokosmilch")).toBe(0);
  expect(one("serving.plant_milk", "Unser Haferl Kaffee")).toBe(0);
  expect(one("serving.decaf", "Koffeinfreier Kräutertee")).toBe(0);
  expect(one("serving.decaf", "Kaffee auch entkoffeiniert, Tee")).toBe(1);
  expect(one("serving.cold_brew", "Cold Brew", "https://chain.example/kaffeeakademie/wiki/cold-brew")).toBe(0);
  expect(one("serving.espresso", "Espresso 250 g", "https://cafe.example/shop/espresso-blend")).toBe(0);
});

test("social links: only accounts whose handle matches the place or its site", async () => {
  const { ownHandle } = await import("../src/pipeline-record");
  expect(ownHandle("neuhauser_muenchen", "Neuhauser Schwabing", "neuhauser-schwabing.de")).toBe(true);
  expect(ownHandle("cafe_lotti", "Cafe Lotti", "https://www.cafe-lotti.de/")).toBe(true);
  expect(ownHandle("ksbbar", "Kaffee", "https://ksbbar.de/")).toBe(true);
  expect(ownHandle("westinmunich", "Sheraton's Lobby", "https://www.marriott.com/")).toBe(false);
  expect(ownHandle("wix", "Café Wunderbar", "https://cafewunderbar.de/")).toBe(false);
  expect(ownHandle("17841405420195327", "Fortuna Cafébar", "https://fortuna-cafebar.de/")).toBe(false);
  expect(ownHandle("elenakilb.official", "Vollaths", "https://vollaths.de/")).toBe(false);
});

test("closure notices count, closing times and closed weekdays do not", () => {
  const ctx = { country: "DE", ownName: "Café X", multiLocation: false };
  const closed = (quote: string) => verify([{ field: "closed_permanently", value: true, page: 1, quote }], [page(quote)], ctx).kept.length;
  expect(closed("Das NähWerk hat zum 30. April 2025 seine Türen geschlossen.")).toBe(1);
  expect(closed("15.4.2020 Wir schließen, Servus Giesing !!")).toBe(1);
  expect(closed("in der KAFFEE, ESPRESSO & BARISTA gefunden, das ist leider Geschichte.")).toBe(1);
  expect(closed("Das Tabula Rasa bleibt geschlossen, gerne könnt ihr uns eine Catering Anfrage stellen.")).toBe(1);
  expect(closed("Wir schließen um 18 Uhr")).toBe(0);
  expect(closed("Montag bleibt geschlossen")).toBe(0);
});

test("a name of place words still matches its own domain", () => {
  const words = placeWordsFrom(["München", "Pasing", "Cotidiano 1"]);
  const site = [{ url: "https://cotidiano.de/standorte/muenchen-pasing/", fetchedAt: "", rendered: false, doc: { title: "Cotidiano Pasing", text: "Cotidiano Pasing, Bodenseestraße 1, 81241 München", links: [], jsonld: "" } }];
  expect(siteMatches(site, { name: "Cotidiano Pasing", street: "Bodenseestraße 1" }, "cotidiano.de", words).ok).toBe(true);
});

test("site names lose all-caps styling and a trailing city", async () => {
  const { siteNameTidy } = await import("../src/pipeline-record");
  expect(siteNameTidy("VOLLATHS", "München")).toBe("Vollaths");
  expect(siteNameTidy("MAN VERSUS MACHINE COFFEE ROASTERS", "München")).toBe("Man Versus Machine Coffee Roasters");
  expect(siteNameTidy("Palmi Muenchen", "München")).toBe("Palmi");
  expect(siteNameTidy("Café Buur München", "München")).toBe("Café Buur");
  expect(siteNameTidy("Seidl`s Cafe Waldtrudering", "München")).toBe("Seidl's Cafe Waldtrudering");
  expect(siteNameTidy("sweet spot kaffee", "München")).toBe("sweet spot kaffee");
});

test("on a site with a web shop, a serving fact needs a menu line", () => {
  const ctx = { country: "DE", ownName: "x", multiLocation: false };
  const shopPage = (q: string) => page(`${q} In den Warenkorb`);
  const one = (f: Proposal["field"], q: string) => verify([{ field: f, value: true, page: 1, quote: q }], [shopPage(q)], ctx).kept.length;
  expect(one("serving.decaf", "Entkoffeinierter Kaffee")).toBe(0);
  expect(one("serving.filter", "Filterkaffee")).toBe(0);
  expect(one("serving.espresso", "Espresso 2,80 €")).toBe(1);
  expect(one("serving.decaf", "Decaf +0,30")).toBe(1);
});

test("own roasting needs a quote that puts the roasting at this place", () => {
  const ctx = { country: "DE", ownName: "Café Beispiel", multiLocation: false };
  const one = (q: string, ownName = ctx.ownName) => verify([{ field: "roasts_own_beans", value: true, page: 1, quote: q }], [page(q)], { ...ctx, ownName }).kept.length;
  expect(one("Unser Kaffee wird sorgfältig geröstet")).toBe(0);
  expect(one("Unsere Röstungen")).toBe(0);
  expect(one("Die Beans kommen von zwei Türen weiter, geröstet vom Nachbarn")).toBe(0);
  expect(one("Hier rösten wir unseren Kaffee selbst")).toBe(1);
  expect(one("Café & Rösterei in Kreuzberg")).toBe(1);
  expect(one("Unsere eigene Rösterei im Wedding", "Beispiel Kaffeerösterei")).toBe(1);
  expect(one("Unsere eigene Rösterei im Wedding")).toBe(0);
});

test("on a site with several locations, own roasting must be tied to this one", () => {
  const ctx = { country: "DE", ownName: "x", multiLocation: true, street: "Chausseestraße 5", postcode: "10115" };
  const text = "19grams Alex ist unsere Rösterei, hier rösten wir. Alexanderstraße 1, 10178 Berlin. Espresso 3,00";
  const out = verify([{ field: "roasts_own_beans", value: true, page: 1, quote: "hier rösten wir" }], [page(text)], ctx);
  expect(out.kept.length).toBe(0);
  const own = "Kaffeebar in der Chausseestraße 5, 10115 Berlin. Hier rösten wir unseren Kaffee selbst.";
  expect(verify([{ field: "roasts_own_beans", value: true, page: 1, quote: "Hier rösten wir unseren Kaffee selbst" }], [page(own)], ctx).kept.length).toBe(1);
});
