// Data Explorer: one filter state (mirrored in the URL hash) drives the map and the table.
import {
  constructTable,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { fieldUrl } from "@roastbook/ui/sites";
import { activeCount, emptyFilters, matches, parseHash, toHash, type Filters, type HashState } from "./filter";
import { LABELS, STATUS_LABEL, TIER_LABEL } from "./fields";
import { createMap, type PlaceMap } from "./map";

const root = document.querySelector<HTMLElement>("[data-explorer]")!;
const form = root.querySelector<HTMLFormElement>("[data-filters]")!;
const countEl = root.querySelector<HTMLElement>("[data-count]")!;
const panes = root.querySelector<HTMLElement>("[data-panes]")!;
const tableEl = root.querySelector<HTMLTableElement>("[data-table]")!;
const pager = root.querySelector<HTMLElement>("[data-pager]")!;
const detail = root.querySelector<HTMLElement>("[data-detail]")!;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const yesNo = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "—");
const date = (s?: string) => (s ? s.slice(0, 10) : "");

let state: HashState = parseHash(location.hash);
let places: any[] = [];
let byId = new Map<string, any>();
let map: PlaceMap | null = null;
let lastOpener: HTMLElement | null = null;

// ---- Table (TanStack Table core, rendered by hand) ----
const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const col = createColumnHelper<typeof features, any>();
const tierRank: Record<string, number> = { A: 0, B: 1, none: 2, unknown: 3 };
const columns = col.columns([
  col.accessor("name", { header: "Name", meta: { path: "name" } }),
  col.accessor((p) => p._city_name, { id: "city", header: "City", meta: { path: "address.locality" } }),
  col.accessor((p) => tierRank[p.specialty_tier] ?? 9, { id: "tier", header: "Tier", meta: { path: "specialty_tier" } }),
  col.accessor((p) => STATUS_LABEL[p.status] ?? p.status, { id: "status", header: "Status", meta: { path: "status" } }),
  col.accessor((p) => yesNo(p.roasts_own_beans), { id: "roasts", header: "Roasts own", meta: { path: "roasts_own_beans" } }),
  col.accessor((p) => yesNo(p.serving?.filter), { id: "filter", header: "Filter", meta: { path: "serving.filter" } }),
  col.accessor((p) => yesNo(p.sells_equipment), { id: "equipment", header: "Equipment", meta: { path: "sells_equipment" } }),
]);
const table = constructTable({
  features,
  columns,
  data: [] as any[],
  getRowId: (p: any) => p.id,
  initialState: { pagination: { pageIndex: 0, pageSize: 25 }, sorting: [{ id: "tier", desc: false }] },
});

function renderTable() {
  const thead = tableEl.tHead!;
  thead.innerHTML = "";
  for (const group of table.getHeaderGroups()) {
    const tr = thead.insertRow();
    for (const h of group.headers) {
      const th = document.createElement("th");
      th.scope = "col";
      const sorted = h.column.getIsSorted();
      th.setAttribute("aria-sort", sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sort";
      btn.innerHTML = `${esc(h.column.columnDef.header)} <span aria-hidden="true">${sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}</span>`;
      btn.addEventListener("click", (e) => { h.column.getToggleSortingHandler()?.(e); renderTable(); thead.querySelectorAll<HTMLButtonElement>("button.sort")[h.index]?.focus(); });
      th.append(btn);
      tr.append(th);
    }
  }
  const rows = table.getRowModel().rows;
  tableEl.tBodies[0].innerHTML = rows.length
    ? rows.map((row) => {
        const p = row.original;
        const href = `#${toHash({ ...state, place: p.id })}`;
        return `<tr data-id="${esc(p.id)}">
          <th scope="row"><a href="${esc(href)}" data-place-link>${esc(p.name)}</a></th>
          <td>${esc(p._city_name)}</td>
          <td><span class="tier-icon" data-tier="${p.specialty_tier === "A" || p.specialty_tier === "B" ? p.specialty_tier : "other"}" aria-hidden="true"></span> ${esc(TIER_LABEL[p.specialty_tier] ?? p.specialty_tier)}</td>
          <td>${esc(STATUS_LABEL[p.status] ?? p.status)}</td>
          <td>${yesNo(p.roasts_own_beans)}</td>
          <td>${yesNo(p.serving?.filter)}</td>
          <td>${yesNo(p.sells_equipment)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="${columns.length}" class="muted">No places match these filters.</td></tr>`;

  const page = table.atoms.pagination.get().pageIndex;
  const pages = Math.max(1, table.getPageCount());
  pager.innerHTML = `
    <button type="button" data-page="prev" ${table.getCanPreviousPage() ? "" : "disabled"}>Previous</button>
    <span class="tabular">Page ${page + 1} of ${pages}</span>
    <button type="button" data-page="next" ${table.getCanNextPage() ? "" : "disabled"}>Next</button>`;
}
pager.addEventListener("click", (e) => {
  const which = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-page]")?.dataset.page;
  if (!which) return;
  if (which === "prev") table.previousPage(); else table.nextPage();
  renderTable();
  pager.querySelector<HTMLButtonElement>(`[data-page="${which}"]:not([disabled])`)?.focus();
});

// ---- Filters <-> form <-> hash ----
function readForm(): Filters {
  const fd = new FormData(form);
  return {
    q: String(fd.get("q") ?? "").trim(),
    city: String(fd.get("city") ?? ""),
    tier: fd.getAll("tier").map(String),
    status: fd.getAll("status").map(String),
    serving: fd.getAll("serving").map(String),
    amenities: fd.getAll("amenities").map(String),
    roasts: fd.has("roasts"),
    equipment: fd.has("equipment"),
    inview: fd.has("inview"),
  };
}

function writeForm(f: Filters) {
  (form.elements.namedItem("q") as HTMLInputElement).value = f.q;
  (form.elements.namedItem("city") as HTMLSelectElement).value = f.city;
  for (const input of form.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
    const v = (f as any)[input.name];
    input.checked = Array.isArray(v) ? v.includes(input.value) : Boolean(v);
  }
  for (const d of form.querySelectorAll("details")) if (d.querySelector("input:checked")) d.open = true;
}

function setView(view: "map" | "table") {
  state.view = view;
  panes.dataset.active = view;
  for (const b of root.querySelectorAll<HTMLButtonElement>("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  if (view === "map") map?.resize();
}

function apply({ keepPage = false, fromMove = false } = {}) {
  const base = places.filter((p) => matches(p, state.filters, null));
  const bounds = state.filters.inview ? map?.bounds() ?? null : null;
  const list = bounds ? base.filter((p) => matches(p, state.filters, bounds)) : base;
  table.setOptions((prev: any) => ({ ...prev, data: list }));
  if (!keepPage) table.setPageIndex(0);
  renderTable();
  const n = activeCount(state.filters);
  countEl.textContent = `${list.length} of ${places.length} places${n ? ` · ${n} filter${n === 1 ? "" : "s"} active` : ""}`;
  const hash = toHash(state);
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  if (!fromMove) map?.setData(base); // the map keeps showing places outside the view
}

form.addEventListener("input", () => { state.filters = readForm(); apply(); });
form.addEventListener("reset", () => setTimeout(() => { state.filters = emptyFilters(); writeForm(state.filters); apply(); }));
for (const b of root.querySelectorAll<HTMLButtonElement>("[data-view]")) b.addEventListener("click", () => { setView(b.dataset.view as "map" | "table"); apply({ keepPage: true }); });

// Phone: filters collapse behind a toggle so the map stays in view.
const toggle = form.querySelector<HTMLButtonElement>("[data-filters-toggle]")!;
const setFiltersOpen = (open: boolean) => {
  form.toggleAttribute("data-collapsed", !open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Hide filters" : `Show filters${activeCount(state.filters) ? ` (${activeCount(state.filters)})` : ""}`;
};
toggle.addEventListener("click", () => setFiltersOpen(form.hasAttribute("data-collapsed")));
setFiltersOpen(!matchMedia("(max-width: 959px)").matches);

// ---- Detail panel ----
function formatValue(path: string, v: any): string {
  if (v === true || v === false) return yesNo(v);
  if (path === "specialty_tier") return esc(TIER_LABEL[v] ?? v);
  if (path === "status") return esc(STATUS_LABEL[v] ?? v);
  if (path === "location") return `${v.lat}, ${v.lon}`;
  if (path === "xref.wikidata") return `<a href="https://www.wikidata.org/wiki/${esc(v)}">${esc(v)}</a>`;
  if (typeof v === "string" && /^https?:\/\//.test(v)) return `<a href="${esc(v)}" rel="nofollow noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, ""))}</a>`;
  if (path === "prices.cappuccino") return `${esc(v.amount.toFixed(2))} ${esc(v.currency)} <span class="muted">(observed ${esc(v.observed_on)}${v.source_url ? `, <a href="${esc(v.source_url)}" rel="nofollow noopener">menu</a>` : ""})</span>`;
  if (path === "operator") return esc([v.name, v.legal_form && !v.name.includes(v.legal_form) ? v.legal_form : "", v.register_id].filter(Boolean).join(", "));
  if (Array.isArray(v)) {
    return `<ul class="plain">${v.map((x) => `<li>${
      typeof x !== "object" ? esc(String(x).replaceAll("_", " "))
      : path === "roasters_served" ? `${x.url ? `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.name)}</a>` : esc(x.name)}${x.own ? " (own roastery)" : ""}`
      : path === "awards" ? `${x.url ? `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.name)}</a>` : esc(x.name)}${x.year ? ` ${x.year}` : ""}`
      : path === "external_ratings" ? `${x.url ? `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.source)}</a>` : esc(x.source)} <span class="muted">(reference only; we store no rating values)</span>`
      : esc(JSON.stringify(x))
    }</li>`).join("")}</ul>`;
  }
  return esc(typeof v === "string" ? v.replaceAll("_", " ").replace(/^(coffee|food) led$/, "$1-led") : v);
}

const SKIP = new Set(["id", "name", "image", "checked_at", "last_verified_at"]);

function detailRows(p: any) {
  const rows: string[] = [];
  const row = (path: string, v: any) => {
    const label = LABELS[path] ?? path.split(".").pop()!.replaceAll("_", " ");
    rows.push(`<div class="kv"><dt><a href="${esc(fieldUrl(path))}" title="Definition of ${esc(path)} in the Schema Explorer">${esc(label)}</a></dt><dd>${formatValue(path, v)}</dd></div>`);
  };
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith("_") || SKIP.has(k) || v === undefined) continue;
    const nested = v && typeof v === "object" && !Array.isArray(v) && !["location", "operator", "prices"].includes(k);
    if (nested) for (const [k2, v2] of Object.entries(v as object)) row(`${k}.${k2}`, v2);
    else if (k === "prices") for (const [k2, v2] of Object.entries(v as object)) row(`prices.${k2}`, v2);
    else row(k, v);
  }
  return rows.join("");
}

function renderDetail(p: any) {
  const img = p.image
    ? `<figure class="detail__image"><img src="${esc(p.image.url)}" alt="${esc(p.image.title ?? `Photo of ${p.name}`)}" loading="lazy" ${p.image.width ? `width="${p.image.width}" height="${p.image.height}"` : ""} />
        <figcaption>Photo: ${esc(p.image.author)}, <a href="${esc(fieldUrl("image.licence"))}">licence</a> ${esc(p.image.licence)}, <a href="${esc(p.image.source_url)}" rel="nofollow noopener">source</a></figcaption></figure>`
    : "";
  const permalink = `${location.origin}${location.pathname}#place=${encodeURIComponent(p.id)}`;
  detail.innerHTML = `
    <div class="detail__head">
      <h2 id="detail-title">${esc(p.name)}</h2>
      <button type="button" class="detail__close" data-close aria-label="Close details">✕</button>
    </div>
    <p class="detail__meta"><span class="tier-icon" data-tier="${p.specialty_tier === "A" || p.specialty_tier === "B" ? p.specialty_tier : "other"}" aria-hidden="true"></span> ${esc(TIER_LABEL[p.specialty_tier])} · ${esc(STATUS_LABEL[p.status])} · ${esc(p._city_name)}</p>
    <p class="detail__links"><a href="${esc(permalink)}" data-permalink>Permalink</a> · <a href="/${esc(p._file)}">JSON file</a> · <code>${esc(p.id)}</code></p>
    ${img}
    <dl class="kvs">${detailRows(p)}</dl>
    <p class="muted"><a href="${esc(fieldUrl("checked_at"))}">Checked</a> ${esc(date(p.checked_at))}${p.last_verified_at ? ` · <a href="${esc(fieldUrl("last_verified_at"))}">last verified</a> ${esc(date(p.last_verified_at))}` : ""}</p>
    <p class="muted small">Something wrong? <a href="https://github.com/Roastbook/open-coffee-data/issues/new?title=${encodeURIComponent(`Correct ${p.name} (${p.id})`)}">Suggest a correction</a>.</p>`;
}

function openPlace(id: string | null, { fromHash = false } = {}) {
  const p = id ? byId.get(id) : null;
  if (!p) {
    if (!detail.hidden) { detail.hidden = true; root.classList.remove("has-detail"); lastOpener?.focus(); }
    return;
  }
  if (!fromHash) lastOpener = document.activeElement as HTMLElement;
  renderDetail(p);
  detail.hidden = false;
  root.classList.add("has-detail");
  detail.focus({ preventScroll: true });
  for (const tr of tableEl.tBodies[0].rows) tr.classList.toggle("is-selected", tr.dataset.id === p.id);
  if (state.view === "map") map?.focus(p);
}

function closeDetail() {
  state.place = null;
  const hash = toHash(state);
  history.pushState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  openPlace(null);
}
detail.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-close]")) closeDetail(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !detail.hidden) closeDetail(); });
tableEl.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-place-link]")) lastOpener = e.target as HTMLElement; });

window.addEventListener("hashchange", () => {
  const next = parseHash(location.hash);
  if (toHash({ ...next, place: null }) !== toHash({ ...state, place: null })) {
    state = next;
    writeForm(state.filters);
    setView(state.view);
    apply();
  }
  state.place = next.place;
  openPlace(state.place, { fromHash: true });
});

// ---- Start ----
(async () => {
  try {
    const res = await fetch("/explorer/places.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    places = payload.places;
    byId = new Map(places.map((p) => [p.id, p]));
  } catch (e) {
    countEl.textContent = `Could not load the places (${(e as Error).message}). Try the downloads page.`;
    return;
  }
  writeForm(state.filters);
  setView(state.view);
  map = createMap(root.querySelector<HTMLElement>("[data-map]")!, places, (id) => { location.hash = toHash({ ...state, place: id }); }, () => { if (state.filters.inview) apply({ fromMove: true }); });
  apply();
  if (state.place) openPlace(state.place, { fromHash: true });
})();
