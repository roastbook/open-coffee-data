import { expect, test } from "bun:test";
import { normaliseHours, opensOnSunday, timesInQuote } from "../src/hours";

test("normalises LLM output to canonical opening_hours", () => {
  expect(normaliseHours("Mo–Fr 8:00–18:00; Sa,Su 9.30 - 17:00")).toBe("Mo-Fr 08:00-18:00; Sa,Su 09:30-17:00");
  expect(normaliseHours("Mo: 08:00-18:00;")).toBe("Mo 08:00-18:00");
  expect(normaliseHours("Mo-Fr 08:00-18:00; Su off")).toBe("Mo-Fr 08:00-18:00; Su off");
});

test("rejects what does not parse", () => {
  expect(normaliseHours("Montag bis Freitag acht bis sechs")).toBeNull();
  expect(normaliseHours("unknown")).toBeNull();
  expect(normaliseHours("")).toBeNull();
});

test("every time in the value must appear in the quote", () => {
  expect(timesInQuote("Mo-Fr 08:00-18:00; Sa 09:30-17:00", "Mo–Fr 8–18 Uhr, Sa 9:30–17 Uhr")).toBe(true);
  expect(timesInQuote("Mo-Fr 08:00-19:00", "Monday - Friday 8 AM - 7 PM")).toBe(true);
  expect(timesInQuote("Mo-Fr 08:00-19:00", "Mo–Fr 8–18 Uhr")).toBe(false);
  expect(timesInQuote("Mo-Fr 08:00-18:00", "Mo–Fr 18 Uhr")).toBe(false);
});

test("Sunday opening is derived from the hours", () => {
  expect(opensOnSunday("Mo-Fr 08:00-18:00")).toBe(false);
  expect(opensOnSunday("Mo-Su 08:00-18:00")).toBe(true);
  expect(opensOnSunday("Sa,Su 10:00-16:00")).toBe(true);
});
