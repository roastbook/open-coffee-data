import { expect, test } from "bun:test";
import { tier, type TierInput } from "../src/tier";

const base: TierInput = { name: "Kaffee Beispiel", roasters: [], siteVerified: true, servesPublic: true };

test("A: roasts own specialty coffee and coffee leads", () => {
  expect(tier({ ...base, roastsOwn: true, specialtyClaim: true, business: "roastery" }).tier).toBe("A");
  expect(tier({ ...base, roasters: [{ name: "The Barn", fromPartnerPage: true }], focus: "coffee_led" }).tier).toBe("A");
});

test("B: specialty roaster but food leads", () => {
  expect(tier({ ...base, roasters: [{ name: "Merchant & Friends", fromPartnerPage: true }], business: "restaurant" }).tier).toBe("B");
});

test("a roaster named on the site needs a specialty claim; commodity brands never count", () => {
  expect(tier({ ...base, roasters: [{ name: "Kleine Rösterei", fromPartnerPage: false }], focus: "coffee_led" }).tier).toBe("unknown");
  expect(tier({ ...base, roasters: [{ name: "Lavazza", fromPartnerPage: false }], specialtyClaim: true }).tier).toBe("none");
});

test("no evidence of serving visitors keeps a roastery unknown", () => {
  expect(tier({ ...base, roastsOwn: true, specialtyClaim: true, business: "roastery", servesPublic: false }).tier).toBe("unknown");
});

test("none: chains and clearly non-coffee businesses", () => {
  expect(tier({ ...base, name: "Starbucks" }).tier).toBe("none");
  expect(tier({ ...base, name: "Pizzeria Roma", siteVerified: false }).tier).toBe("none");
  expect(tier({ ...base, business: "bakery" }).tier).toBe("none");
  expect(tier({ ...base }).tier).toBe("unknown");
});
