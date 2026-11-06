import type { Candidate } from "./candidate";
import type { City } from "./cities";
import type { OvertureRow } from "./discovery/overture";
import type { Rejected, Verified } from "./extract";
import type { Research } from "./research";
import type { Site } from "./site";

export interface RunOptions { city: City; limit: number; dryRun: boolean; stages?: string[] }
export type Row = OvertureRow & { coffee: boolean };
export interface Enriched {
  site?: Site; match?: string; facts: Verified[]; rejected: Rejected[]; multi: boolean;
  websiteTried: string[]; websiteSearch?: string; error?: string; injectionLines: number;
}
export interface Provenance { value: unknown; via: string; url?: string; quote?: string }
export type ProvenanceMap = Map<string, Provenance>;
export interface Change { id: string; name: string; field: string; old: unknown; new: unknown; url?: string; quote?: string }
export interface Unlocated { via: string; name: string; reason: string }
export interface Conflict { id: string; name: string; reason: string }
export interface RunLog {
  id: string; name: string; reason: string; origins: Candidate["origins"];
  site: { start: string; ok: boolean; error?: string; pages: { url: string; fetchedAt: string; rendered: boolean }[] } | null;
  match?: string; websiteSearch?: string; values: { [field: string]: Provenance };
  rejected: Pick<Rejected, "field" | "value" | "reason">[]; conflict?: string; tierWhy: string;
  research?: Pick<Research, "queries" | "opened">;
}
export const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");
export function stringFact(facts: Verified[], field: string) {
  return facts.find((f): f is Verified & { value: string } => f.field === field && typeof f.value === "string");
}
export const overtureUrl = (id?: string) => `https://explore.overturemaps.org/#id=${id}`;
