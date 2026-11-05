import { expect, test } from "bun:test";
import { ID_ALPHABET, ID_RE, newId } from "../src/ids";

test("ids are cp- plus 10 characters from the alphabet", () => {
  for (let i = 0; i < 2000; i++) expect(newId()).toMatch(ID_RE);
  expect(ID_ALPHABET).toHaveLength(32);
  expect(ID_ALPHABET).not.toMatch(/[ilou]/);
});

test("ids are unique against taken ids and spread over the whole alphabet", () => {
  const taken = new Set<string>();
  for (let i = 0; i < 5000; i++) newId(taken);
  expect(taken.size).toBe(5000);
  const chars = new Set([...taken].join("").slice(0));
  for (const c of ID_ALPHABET) expect(chars.has(c)).toBe(true);
});
