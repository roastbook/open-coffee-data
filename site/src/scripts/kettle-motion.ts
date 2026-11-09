// Moves the pour point along each kettle path: the stream traces its path and leaves a trail,
// hybrid movements switch from one segment to the next. Only diagrams on screen animate;
// with reduced motion nothing moves and the full paths stay visible.
const CYCLE_MS = 4000;

interface Seg { g: SVGGElement; path: SVGPathElement | null; len: number; nozzle: SVGCircleElement | null }

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const diagrams = [...document.querySelectorAll<SVGSVGElement>(".kettle-path")].map((svg) => ({
    svg,
    segs: [...svg.querySelectorAll<SVGGElement>(".seg")].map((g): Seg => {
      const path = g.querySelector<SVGPathElement>("path.trace");
      return { g, path, len: path?.getTotalLength() ?? 0, nozzle: g.querySelector<SVGCircleElement>(".nozzle") };
    }),
  }));
  const visible = new Set<SVGSVGElement>();
  const io = new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? visible.add(e.target as SVGSVGElement) : visible.delete(e.target as SVGSVGElement))));
  diagrams.forEach(({ svg }) => { svg.classList.add("moving"); io.observe(svg); });

  const tick = (now: number) => {
    for (const { svg, segs } of diagrams) {
      if (!visible.has(svg) || !segs.length) continue;
      const pos = ((now % (CYCLE_MS * segs.length)) / CYCLE_MS);
      const active = Math.floor(pos), p = pos - active;
      segs.forEach((s, i) => {
        s.g.classList.toggle("active", i === active);
        if (!s.path) return;
        // Trail: the active segment draws itself, finished ones stay, later ones wait.
        s.path.style.strokeDashoffset = String(i < active ? 0 : i > active ? 100 : 100 * (1 - p));
        if (i === active && s.nozzle) {
          const pt = s.path.getPointAtLength(p * s.len);
          s.nozzle.setAttribute("cx", String(pt.x));
          s.nozzle.setAttribute("cy", String(pt.y));
        }
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
