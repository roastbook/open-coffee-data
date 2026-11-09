// Geometry for the Pour patterns page: phase timelines (flow and poured water over time)
// and kettle movement paths. Pure functions, unit-tested in scripts/tests/pour.test.mjs.

export interface FlowPoint { at_seconds: number; grams_per_second: number }
export interface Phase {
  id: string;
  type: "pour" | "hold" | "drawdown";
  duration_seconds: number;
  water_fraction?: number;
  flow?: "constant" | "ramp_up" | "ramp_down" | "custom";
  flow_curve?: FlowPoint[];
  movement?: string;
  agitation?: string[];
  note?: string;
}
export interface PathSegment { shape: "point" | "circle" | "spiral" | "line"; radius?: number; turns?: number; angle_degrees?: number }
export interface Segment { phase: Phase; start: number; end: number; flow: [number, number][]; waterStart: number; waterEnd: number }
type Pt = [number, number];

/** Flow of one pour phase as [seconds since phase start, g/s] points. Ramps keep the phase's average flow. */
function phaseFlow(p: Phase, water: number): Pt[] {
  if (p.type !== "pour") return [];
  if (p.flow === "custom" && p.flow_curve) return p.flow_curve.map((c) => [c.at_seconds, c.grams_per_second]);
  const d = p.duration_seconds;
  const avg = ((p.water_fraction ?? 0) * water) / d;
  if (p.flow === "ramp_up") return [[0, avg * 0.5], [d, avg * 1.5]];
  if (p.flow === "ramp_down") return [[0, avg * 1.5], [d, avg * 0.5]];
  return [[0, avg], [d, avg]];
}

const area = (pts: Pt[]) => pts.reduce((s, [x, r], i) => (i ? s + ((x - pts[i - 1][0]) * (r + pts[i - 1][1])) / 2 : s), 0);

/** Phases laid out one after the other, with absolute times and the water in the brewer before and after each. */
export function timeline(phases: Phase[], water: number): Segment[] {
  let t = 0, w = 0;
  return phases.map((phase) => {
    const start = t;
    t += phase.duration_seconds;
    const flow = phaseFlow(phase, water).map(([x, r]): Pt => [start + x, r]);
    const seg = { phase, start, end: t, flow, waterStart: w, waterEnd: w + area(flow) };
    w = seg.waterEnd;
    return seg;
  });
}

/** Poured water over time: [seconds, grams], with each linear flow edge split so ramps curve. */
export function pouredCurve(segments: Segment[]): Pt[] {
  const out: Pt[] = [[0, 0]];
  for (const s of segments) {
    let w = s.waterStart;
    for (let i = 1; i < s.flow.length; i++) {
      const [x0, r0] = s.flow[i - 1], [x1, r1] = s.flow[i];
      for (let k = 1; k <= 8; k++) {
        const x = x0 + ((x1 - x0) * k) / 8, r = r0 + ((r1 - r0) * k) / 8;
        out.push([x, w + ((x - x0) * (r0 + r)) / 2]);
      }
      w += ((x1 - x0) * (r0 + r1)) / 2;
    }
    out.push([s.end, s.waterEnd]);
  }
  return out;
}

/** Points of a kettle path seen from above, in bed-radius units (centre 0,0; y down). */
export function pathPoints(seg: PathSegment): Pt[] {
  const r = seg.radius ?? 0.5, turns = seg.turns ?? 2, a = ((seg.angle_degrees ?? 0) * Math.PI) / 180;
  const at = (rad: number, ang: number): Pt => [rad * Math.sin(ang), -rad * Math.cos(ang)];
  const n = Math.max(24, Math.round(turns * 48));
  const range = (count: number) => Array.from({ length: count + 1 }, (_, i) => i / count);
  switch (seg.shape) {
    case "point":
      return [at(r, a)];
    case "circle":
      return range(n).map((f) => at(r, f * turns * 2 * Math.PI));
    case "spiral": {
      const out = range(n).map((f) => at(r * f, f * turns * 2 * Math.PI));
      return [...out, ...out.slice(0, -1).reverse()];
    }
    case "line":
      // Sweeps drift sideways as a zig-zag so repeated passes stay visible.
      return range(Math.max(1, Math.round(turns * 2))).map((f, i) => {
        const [x, y] = at(i % 2 ? r : -r, a);
        const off = (f - 0.5) * 0.8;
        return [x + off * Math.cos(a), y + off * Math.sin(a)];
      });
  }
}

export const svgPath = (pts: Pt[], sx = (x: number) => x, sy = (y: number) => y) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ");

/** Short display name of a phase: "Wait" and "Drawdown" by type, pours from their id (pour-2 → Pour 2). */
export const phaseLabel = (p: Phase) =>
  p.type === "hold" ? "Wait" : p.type === "drawdown" ? "Drawdown" : (p.id.charAt(0).toUpperCase() + p.id.slice(1)).replaceAll("-", " ");

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
