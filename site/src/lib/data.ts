// Build-time access to the datasets. scripts/build.sh sets DATASETS_DIR and ARTIFACTS_DIR;
// the defaults work for `pnpm dev` inside site/.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { coffeePlaces, datasetVersion, loadDatasets } from "../../../scripts/lib/datasets.mjs";

const datasetsDir = resolve(process.env.DATASETS_DIR ?? resolve(process.cwd(), "../datasets"));
const artifactsDir = resolve(process.env.ARTIFACTS_DIR ?? resolve(process.cwd(), "../.cache/artifacts"));

export interface DatasetFile { rel: string; family: string; doc: any; records: any[] }
export const files: DatasetFile[] = loadDatasets(datasetsDir);
export const places: any[] = coffeePlaces(files).filter((p: any) => !p.merged_into);
export const version: string = datasetVersion(files) ?? "unreleased";
export const buildDate: string = process.env.BUILD_DATE ?? new Date().toISOString().slice(0, 10);
export const sources: any = JSON.parse(readFileSync(resolve(datasetsDir, "sources.json"), "utf8"));
export const brewMethods: any[] = files.filter((f) => f.family === "brew-methods").flatMap((f) => f.records);
export const artifactsIndex: any = existsSync(resolve(artifactsDir, "index.json"))
  ? JSON.parse(readFileSync(resolve(artifactsDir, "index.json"), "utf8"))
  : { datasets: [], artifacts: [] };
export const cities: { slug: string; name: string; country: string }[] = files
  .filter((f) => f.family === "coffee-places")
  .map((f) => ({ slug: f.doc.meta.city, name: f.doc.meta.city_name ?? f.doc.meta.city, country: f.doc.meta.country_code }));

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
