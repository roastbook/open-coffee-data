import { expect, test } from "bun:test";
import { tier, type TierInput } from "../src/tier";

const base: TierInput = { name: "Kaffee Beispiel", roasters: [], siteVerified: true };

test("A: roasts its own coffee and coffee leads", () => {
  expect(tier({ ...base, roastsOwn: true, business: "roastery" }).tier).toBe("A");
  expect(tier({ ...base, roasters: [{ name: "The Barn" }], specialtyClaim: true, focus: "coffee_led" }).tier).toBe("A");
});

test("B: names a specialty roaster on its own site but food leads", () => {
  expect(tier({ ...base, roasters: [{ name: "Merchant & Friends" }], specialtyClaim: true, focus: "food_led" }).tier).toBe("B");
});

test("a named roaster needs a specialty claim or a place on the specialty roaster list; commodity brands never count", () => {
  expect(tier({ ...base, roasters: [{ name: "Kleine Rösterei" }], focus: "coffee_led" }).tier).toBe("none");
  expect(tier({ ...base, roasters: [{ name: "Man vs. Machine" }], focus: "coffee_led" }).tier).toBe("A");
  expect(tier({ ...base, roasters: [{ name: "Lavazza" }], specialtyClaim: true }).tier).toBe("none");
});

test("none: chains, non-coffee businesses and places without specialty evidence", () => {
  expect(tier({ ...base, name: "Starbucks" }).tier).toBe("none");
  expect(tier({ ...base, name: "Pizzeria Roma", siteVerified: false }).tier).toBe("none");
  expect(tier({ ...base, business: "bakery" }).tier).toBe("none");
  expect(tier({ ...base }).tier).toBe("none");
  expect(tier({ ...base, specialtyClaim: true }).tier).toBe("none");
});
