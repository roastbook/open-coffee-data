// Runtime configuration. Everything comes from env so the same code runs locally and in the scheduled workflow.
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dir, "../..");
export const CACHE = process.env.SOURCING_CACHE_DIR ?? join(REPO, ".cache");
export const DATASETS = join(REPO, "datasets/coffee-places");
export const USER_AGENT = "RoastbookOpenCoffee/1.0 (+https://github.com/Roastbook/open-coffee-data)";
export const SCHEMA_URL = "https://schema.roastbook.coffee/coffee-places/coffee-places.schema.v0.3.0.json";
export const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE ?? "2026-10-21.0";

export const llm = {
  baseUrl: (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, ""),
  apiKey: process.env.LLM_API_KEY ?? "",
  model: process.env.LLM_MODEL ?? "claude/claude-haiku-5-5",
  escalationModel: process.env.LLM_ESCALATION_MODEL ?? "claude/claude-sonnet-5-5",
  // A model the gateway serves through the Responses API with its built-in web_search tool; used to find leads only.
  researchModel: process.env.RESEARCH_MODEL ?? "cx/gpt-5.6-luna",
};

// USD per million tokens (input, output). Haiku 5.5 rates apply to prompts up to 100k tokens, which we never exceed.
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  // The gateway publishes no price for the research model: an estimate, override with RESEARCH_PRICE_*_PER_MTOK.
  "gpt-5.6-luna": [Number(process.env.RESEARCH_PRICE_IN_PER_MTOK ?? 1.25), Number(process.env.RESEARCH_PRICE_OUT_PER_MTOK ?? 10)],
};
/** Fee per web_search tool call made by the research model (USD). */
export const WEB_SEARCH_FEE_USD = Number(process.env.WEB_SEARCH_FEE_USD ?? 0.01);


export const PAGE_TTL_MS = 30 * 24 * 3600 * 1000;
export const REFRESH_DAYS = 90; // opening hours and status, quarterly
export const FULL_REFRESH_DAYS = 182; // full refresh of every field, twice a year
