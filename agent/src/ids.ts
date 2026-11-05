import { randomBytes } from "node:crypto";

export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const ID_RE = /^cp-[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;

/** New permanent place id: cp- plus 10 characters from a crypto random source, never derived from names. */
export function newId(taken: Set<string> = new Set()): string {
  for (;;) {
    // 32 symbols = 5 bits; a byte & 31 is uniform because 256 is a multiple of 32.
    const id = "cp-" + [...randomBytes(10)].map((b) => ID_ALPHABET[b & 31]).join("");
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}
