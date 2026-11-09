// Unit tests for the pour-pattern geometry in site/src/lib/pour.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pathPoints, phaseLabel, pouredCurve, timeline } from "../../site/src/lib/pour.ts";

const phases = [
  { id: "bloom", type: "pour", duration_seconds: 10, water_fraction: 0.2, flow: "constant" },
  { id: "rest", type: "hold", duration_seconds: 30 },
  { id: "main", type: "pour", duration_seconds: 40, water_fraction: 0.8, flow: "ramp_up" },
  { id: "drawdown", type: "drawdown", duration_seconds: 60 },
];

test("timeline adds phases end to end and pours the whole water", () => {
  const segs = timeline(phases, 250);
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 10], [10, 40], [40, 80], [80, 140]]);
  assert.equal(segs[0].flow[0][1], 5);
  assert.ok(Math.abs(segs.at(-1).waterEnd - 250) < 1e-9);
  // A ramp keeps the average flow: 200 g in 40 s, from 2.5 to 7.5 g/s.
  assert.deepEqual(segs[2].flow.map(([, r]) => r), [2.5, 7.5]);
});

test("poured curve rises monotonically to the total", () => {
  const pts = pouredCurve(timeline(phases, 250));
  assert.ok(pts.every(([t, g], i) => !i || (t >= pts[i - 1][0] && g >= pts[i - 1][1] - 1e-9)));
  assert.ok(Math.abs(pts.at(-1)[1] - 250) < 1e-9);
});

test("kettle paths stay inside the bed", () => {
  for (const shape of ["point", "circle", "spiral", "line"]) {
    const pts = pathPoints({ shape, radius: 0.8, turns: 3, angle_degrees: 30 });
    assert.ok(pts.length >= 1);
    assert.ok(pts.every(([x, y]) => Math.hypot(x, y) <= 1), shape);
  }
});

test("phase labels name waits and drawdowns by type and pours by id", () => {
  assert.deepEqual(phases.map(phaseLabel), ["Bloom", "Wait", "Main", "Drawdown"]);
  assert.equal(phaseLabel({ id: "pour-2", type: "pour" }), "Pour 2");
});
