import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactPath, cityArtifactBase } from "../lib/artifact-path.mjs";

test("city artifact names remain inside their output directory", () => {
  const base = cityArtifactBase({ country_code: "DE", city: "example-city" });
  assert.equal(base, "coffee-places/de/example-city");
  assert.equal(artifactPath("/tmp/output", `${base}.geojson`), "/tmp/output/coffee-places/de/example-city.geojson");
  for (const name of ["../../escape", "/tmp/outside", ".", "../output-other/file"]) {
    assert.throws(() => artifactPath("/tmp/output", name), /must stay inside/);
  }
  for (const meta of [
    { country_code: "DE", city: "../../escape" },
    { country_code: "../../DE", city: "example" },
    { country_code: "DE", city: "/absolute" },
    { country_code: "DE", city: "city/other" },
  ]) assert.throws(() => cityArtifactBase(meta), /metadata/);
});
