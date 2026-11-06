import { expect, test } from "bun:test";
import { normaliseHours } from "../src/hours";
import { privateAddress } from "../src/pages";
import { esc } from "../src/pr";

test("private, loopback and link-local addresses are never fetched", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(privateAddress(ip)).toBe(true);
  for (const ip of ["185.199.108.153", "8.8.8.8", "2606:50c0:8000::153"]) expect(privateAddress(ip)).toBe(false);
});

test("untrusted text in PR bodies cannot mention, embed or link", () => {
  const s = esc("@everyone ![x](https://evil.example/i.png) <script>");
  expect(s).not.toContain("@e");
  expect(s).not.toContain("![");
  expect(s).not.toContain("](");
  expect(s).not.toContain("<script");
});

test("closing at midnight is 24:00", () => {
  expect(normaliseHours("Mo-Fr 18:00-00:00")).toBe("Mo-Fr 18:00-24:00");
  expect(normaliseHours("Fr,Sa 20:00-02:00")).toBe("Fr,Sa 20:00-02:00");
});
