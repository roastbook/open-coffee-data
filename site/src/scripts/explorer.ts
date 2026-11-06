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
import { STATUS_LABEL, TIER_LABEL } from "./fields";
import { createMap, type PlaceMap, type MapStatus } from "./map";
import { esc, yesNo, detailRows, httpUrl } from "./detail";
import { parsePlacesPayload, type ExplorerPlace } from "./place";

function requiredElement<T extends Element>(element: T | null, selector: string): T {
  if (!element) throw new Error(`Missing Explorer element: ${selector}`);
  return element;
}

const root = requiredElement(document.querySelector<HTMLElement>("[data-explorer]"), "[data-explorer]");
const form = requiredElement(root.querySelector<HTMLFormElement>("[data-filters]"), "[data-filters]");
const countEl = requiredElement(root.querySelector<HTMLElement>("[data-count]"), "[data-count]");
const showAll = requiredElement(root.querySelector<HTMLButtonElement>("[data-show-all]"), "[data-show-all]");
const panes = requiredElement(root.querySelector<HTMLElement>("[data-panes]"), "[data-panes]");
const tableEl = requiredElement(root.querySelector<HTMLTableElement>("[data-table]"), "[data-table]");
const pager = requiredElement(root.querySelector<HTMLElement>("[data-pager]"), "[data-pager]");
const detail = requiredElement(root.querySelector<HTMLElement>("[data-detail]"), "[data-detail]");

const date = (s?: string) => (s ? s.slice(0, 10) : "");

let state: HashState = parseHash(location.hash);
if (!location.hash) {
  try {
    if (localStorage.getItem("coffee-data-view") === "table") state.view = "table";
  } catch { /* Browsing remains available without storage. */ }
}
let places: ExplorerPlace[] = [];
let byId = new Map<string, ExplorerPlace>();
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
const col = createColumnHelper<typeof features, ExplorerPlace>();
const tierRank: Partial<Record<string, number>> = { A: 0, B: 1, none: 2 };
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
  data: places,
  getRowId: (p) => p.id,
  initialState: { pagination: { pageIndex: 0, pageSize: 25 }, sorting: [{ id: "tier", desc: false }] },
});

function renderTable() {
  const thead = tableEl.createTHead();
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
  requiredElement(tableEl.tBodies.item(0), "tbody").innerHTML = rows.length
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
  const which = (e.target instanceof Element ? e.target.closest<HTMLButtonElement>("[data-page]")?.dataset.page : undefined);
  if (which !== "prev" && which !== "next") return;
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
  const queryInput = form.elements.namedItem("q");
  if (queryInput instanceof HTMLInputElement) queryInput.value = f.q;
  const cityInput = form.elements.namedItem("city");
  if (cityInput instanceof HTMLSelectElement) cityInput.value = f.city;
  for (const input of form.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
    const v = Object.entries(f).find(([name]) => name === input.name)?.[1];
    input.checked = Array.isArray(v) ? v.includes(input.value) : Boolean(v);
  }
  for (const d of form.querySelectorAll("details")) if (d.querySelector("input:checked")) d.open = true;
}

function setView(view: "map" | "table") {
  state.view = view;
  try { localStorage.setItem("coffee-data-view", view); } catch { /* Optional preference. */ }
  panes.dataset.active = view;
  for (const b of root.querySelectorAll<HTMLButtonElement>("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  if (view === "map") map?.resize();
}

function apply({ keepPage = false, fromMove = false } = {}) {
  const base = places.filter((p) => matches(p, state.filters, null));
  showAll.disabled = base.length === 0;
  const bounds = state.filters.inview ? map?.bounds() ?? null : null;
  const list = bounds ? base.filter((p) => matches(p, state.filters, bounds)) : base;
  table.setOptions((prev) => ({ ...prev, data: list }));
  if (!keepPage) table.setPageIndex(0);
  renderTable();
  const n = activeCount(state.filters);
  updateFilterToggle();
  countEl.textContent = `${list.length} of ${places.length} places${n ? ` · ${n} filter${n === 1 ? "" : "s"} active` : ""}`;
  const hash = toHash(state);
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  if (!fromMove) map?.setData(base); // the map keeps showing places outside the view
}

showAll.addEventListener("click", () => {
  state.filters.inview = false;
  writeForm(state.filters);
  apply();
  map?.fitResults();
});

form.addEventListener("input", () => { state.filters = readForm(); apply(); });
form.addEventListener("reset", () => setTimeout(() => { state.filters = emptyFilters(); writeForm(state.filters); apply(); }));
for (const b of root.querySelectorAll<HTMLButtonElement>("[data-view]")) b.addEventListener("click", () => { setView(b.dataset.view === "table" ? "table" : "map"); apply({ keepPage: true }); });

// Phone: filters collapse behind a toggle so the map stays in view.
const toggle = requiredElement(form.querySelector<HTMLButtonElement>("[data-filters-toggle]"), "[data-filters-toggle]");
function updateFilterToggle() {
  const count = activeCount({ ...state.filters, q: "" });
  toggle.textContent = `${form.hasAttribute("data-collapsed") ? "Show" : "Hide"} filters${count ? ` (${count})` : ""}`;
}
const setFiltersOpen = (open: boolean) => {
  form.toggleAttribute("data-collapsed", !open);
  toggle.setAttribute("aria-expanded", String(open));
  updateFilterToggle();
};
toggle.addEventListener("click", () => { setFiltersOpen(form.hasAttribute("data-collapsed")); });
setFiltersOpen(!matchMedia("(max-width: 959px)").matches);

// ---- Detail panel ----
function renderDetail(p: ExplorerPlace) {
  const img = p.image
    ? `<figure class="detail-image"><img src="${esc(httpUrl(p.image.url))}" alt="${esc(p.image.title ?? `Photo of ${p.name}`)}" loading="lazy" ${p.image.width ? `width="${esc(p.image.width)}" height="${esc(p.image.height)}"` : ""} />
        <figcaption>Photo: ${esc(p.image.author)}, <a href="${esc(fieldUrl("image.licence"))}">licence</a> ${esc(p.image.licence)}, <a href="${esc(httpUrl(p.image.source_url))}" rel="nofollow noopener">source</a></figcaption></figure>`
    : "";
  const permalink = `${location.origin}${location.pathname}#place=${encodeURIComponent(p.id)}`;
  detail.innerHTML = `
    <div class="detail-head">
      <h2 id="detail-title">${esc(p.name)}</h2>
      <button type="button" class="detail-close" data-close aria-label="Close details">✕</button>
    </div>
    <p class="detail-meta"><span class="tier-icon" data-tier="${p.specialty_tier === "A" || p.specialty_tier === "B" ? p.specialty_tier : "other"}" aria-hidden="true"></span> ${esc(TIER_LABEL[p.specialty_tier])} · ${esc(STATUS_LABEL[p.status])} · ${esc(p._city_name)}</p>
    <p class="detail-links"><a href="${esc(permalink)}" data-permalink>Permalink</a> · <a href="/${esc(p._file)}">JSON file</a> · <code>${esc(p.id)}</code></p>
    ${img}
    <dl class="kvs">${detailRows(p)}</dl>
    <p class="muted"><a href="${esc(fieldUrl("checked_at"))}">Checked</a> ${esc(date(p.checked_at))}${p.last_verified_at ? ` · <a href="${esc(fieldUrl("last_verified_at"))}">last verified</a> ${esc(date(p.last_verified_at))}` : ""}</p>
    <p class="muted small">Something wrong? <a href="https://github.com/Roastbook/open-coffee-data/issues/new?title=${encodeURIComponent(`Correct ${p.name} (${p.id})`)}">Suggest a correction</a>.</p>`;
}

function openPlace(id: string | null, { fromHash = false } = {}) {
  const p = id ? byId.get(id) : null;
  map?.select(p?.id ?? null);
  if (!p) {
    for (const tr of requiredElement(tableEl.tBodies.item(0), "tbody").rows) tr.classList.remove("is-selected");
    if (!detail.hidden) { detail.hidden = true; root.classList.remove("has-detail"); lastOpener?.focus(); }
    return;
  }
  if (!fromHash) lastOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderDetail(p);
  detail.hidden = false;
  root.classList.add("has-detail");
  detail.focus({ preventScroll: true });
  for (const tr of requiredElement(tableEl.tBodies.item(0), "tbody").rows) tr.classList.toggle("is-selected", tr.dataset.id === p.id);
  if (state.view === "map") map?.focus(p);
}

function closeDetail() {
  state.place = null;
  const hash = toHash(state);
  history.pushState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  openPlace(null);
}
detail.addEventListener("click", (e) => { if (e.target instanceof Element && e.target.closest("[data-close]")) closeDetail(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !detail.hidden) closeDetail(); });
tableEl.addEventListener("click", (e) => { if (e.target instanceof HTMLElement && e.target.closest("[data-place-link]")) lastOpener = e.target; });

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

const mapElement = requiredElement(root.querySelector<HTMLElement>("[data-map]"), "[data-map]");
const mapStatus = requiredElement(root.querySelector<HTMLElement>("[data-map-status]"), "[data-map-status]");
const mapMessage = requiredElement(root.querySelector<HTMLElement>("[data-map-message]"), "[data-map-message]");
const mapRetry = requiredElement(root.querySelector<HTMLButtonElement>("[data-map-retry]"), "[data-map-retry]");
function showMapStatus(status: MapStatus) {
  mapStatus.hidden = status === "ready";
  mapRetry.hidden = status !== "error";
  mapElement.setAttribute("aria-busy", String(status === "loading"));
  mapMessage.textContent = status === "error"
    ? "The map could not finish loading. You can still browse places in the table."
    : "Loading map…";
}
function initializeMap() {
  showMapStatus("loading");
  try {
    map = createMap(mapElement, places, (id) => { location.hash = toHash({ ...state, place: id }); }, () => { if (state.filters.inview) apply({ fromMove: true }); }, showMapStatus);
  } catch {
    showMapStatus("error");
  }
}
mapRetry.addEventListener("click", () => {
  if (map) map.retry(); else initializeMap();
  apply({ keepPage: true });
  map?.select(state.place);
});
requiredElement(root.querySelector<HTMLButtonElement>("[data-map-table]"), "[data-map-table]").addEventListener("click", () => {
  setView("table");
  apply({ keepPage: true });
  root.querySelector<HTMLButtonElement>('[data-view="table"]')?.focus();
});

// ---- Start ----
async function start() {
  try {
    const res = await fetch("/explorer/places.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload: unknown = await res.json();
    places = parsePlacesPayload(payload);
    byId = new Map(places.map((p) => [p.id, p]));
  } catch (e) {
    mapStatus.hidden = true;
    mapElement.setAttribute("aria-busy", "false");
    countEl.textContent = `Could not load the places (${e instanceof Error ? e.message : String(e)}). Try the downloads page.`;
    return;
  }
  writeForm(state.filters);
  setView(state.view);
  initializeMap();
  apply();
  if (state.place) openPlace(state.place, { fromHash: true });
}
start().catch((error: unknown) => {
  countEl.textContent = `Could not start the Explorer (${error instanceof Error ? error.message : String(error)}). Try the downloads page.`;
});
