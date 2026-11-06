// Overture Maps places (latest configured release) read with DuckDB from the public S3 bucket.
// Kept only when every source is permissively licensed and none is OpenStreetMap.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { CACHE, OVERTURE_RELEASE } from "../config";

export const COFFEE_CATEGORIES = ["cafe", "coffee_shop", "coffee_roastery", "coffee_and_tea_supplies"];
const OK_LICENCES = new Set(["CDLA-Permissive-2.0", "Apache-2.0", "CC0-1.0"]); // each is attributed in NOTICE

export type OvertureRow = {
  id: string; name: string; brand: string | null; category: string | null; hierarchy: string[]; alternates: string[];
  websites: string[]; socials: string[]; street: string | null; postcode: string | null; locality: string | null; country: string | null;
  status: string | null; confidence: number; lat: number; lon: number; datasets: string[]; licences: string[];
};

export const licenceStats: Record<string, number> = {};

/** All food/drink, retail and uncategorised places in the bbox (the latter two only help locate mentions). `coffee` marks records in a coffee category (primary or alternate). */
export async function overturePlaces(slug: string, bb: { xmin: number; ymin: number; xmax: number; ymax: number }) {
  const dir = join(CACHE, "overture", OVERTURE_RELEASE);
  const file = join(dir, `${slug}.parquet`);
  const db = await (await DuckDBInstance.create(":memory:")).connect();
  await db.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';");
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const m = 0.002;
    await db.run(`COPY (SELECT * EXCLUDE (geometry), ST_X(geometry) lon, ST_Y(geometry) lat
      FROM read_parquet('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/type=place/*')
      WHERE bbox.xmin BETWEEN ${bb.xmin - m} AND ${bb.xmax + m} AND bbox.ymin BETWEEN ${bb.ymin - m} AND ${bb.ymax + m}) TO '${file}'`);
  }
  const reader = await db.runAndReadAll(`SELECT id, names.primary AS name, brand.names.primary AS brand, taxonomy.primary AS category,
      coalesce(taxonomy.hierarchy, []) AS hierarchy, coalesce(taxonomy.alternates, []) AS alternates,
      coalesce(websites, []) AS websites, coalesce(socials, []) AS socials,
      addresses[1].freeform AS street, addresses[1].postcode AS postcode, addresses[1].locality AS locality, addresses[1].country AS country,
      operating_status AS status, confidence, lat, lon,
      [s.dataset for s in sources] AS datasets, [coalesce(s.license, '') for s in sources] AS licences
    FROM '${file}'
    WHERE taxonomy.primary IS NULL OR list_has_any(taxonomy.hierarchy, ['food_and_drink', 'retail', 'shopping']) OR taxonomy.primary IN ('${COFFEE_CATEGORIES.join("','")}')
       OR list_has_any(taxonomy.alternates, ['${COFFEE_CATEGORIES.join("','")}'])`);
  const rows = reader.getRowObjectsJson() as unknown as OvertureRow[];
  const kept: (OvertureRow & { coffee: boolean })[] = [];
  let dropped = 0;
  for (const r of rows) {
    r.lat = Number(r.lat); r.lon = Number(r.lon); r.confidence = Number(r.confidence);
    for (const l of new Set(r.licences)) licenceStats[l || "(none)"] = (licenceStats[l || "(none)"] ?? 0) + 1;
    if (r.datasets.some((d) => /openstreetmap|^osm$/i.test(d)) || r.licences.some((l) => !OK_LICENCES.has(l))) { dropped++; continue; }
    r.websites = r.websites.filter(Boolean);
    // A coffee category as the main one, or as a side category of a food or drink place (not a bookshop with a café corner).
    const coffee = COFFEE_CATEGORIES.includes(r.category ?? "") || (r.hierarchy.includes("food_and_drink") && r.alternates.some((a) => COFFEE_CATEGORIES.includes(a)));
    kept.push({ ...r, coffee });
  }
  return { rows: kept, dropped };
}
