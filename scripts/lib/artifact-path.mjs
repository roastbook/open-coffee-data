import { isAbsolute, relative, resolve, sep } from "node:path";

/** Artifact names include dataset metadata, so verify containment before writing. */
export function artifactPath(root, name) {
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Artifact path must stay inside the output directory: ${name}`);
  }
  return target;
}

export function cityArtifactBase({ country_code, city }) {
  if (typeof country_code !== "string" || !/^[a-z]{2}$/i.test(country_code) ||
      typeof city !== "string" || !/^[a-z0-9-]+$/.test(city)) {
    throw new Error("Artifact city metadata must use an ISO country code and a city slug");
  }
  return `coffee-places/${country_code.toLowerCase()}/${city}`;
}
