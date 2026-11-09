// Recipe cards on the Pour patterns page: rescale every gram and g/s value to the chosen dose.
// Values at the example dose sit in data-g / data-gs; the card's example dose in data-dose.
for (const card of document.querySelectorAll<HTMLElement>(".recipe[data-dose]")) {
  const dose = card.querySelector<HTMLInputElement>("input.dose");
  const base = Number(card.dataset.dose);
  dose?.addEventListener("input", () => {
    const v = Number(dose.value);
    if (!(v > 0 && v <= 200)) return;
    const k = v / base;
    card.querySelectorAll<HTMLElement | SVGElement>("[data-g]").forEach((e) => { e.textContent = String(Math.round(Number(e.dataset.g) * k)); });
    card.querySelectorAll<HTMLElement | SVGElement>("[data-gs]").forEach((e) => { e.textContent = String(Math.round(Number(e.dataset.gs) * k * 10) / 10); });
  });
}
