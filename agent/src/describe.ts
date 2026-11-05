// Descriptions are generated from the stored record only (no page text, no LLM), so they can never say more than the data.
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function describe(r: any): string | undefined {
  if (r.specialty_tier !== "A" && r.specialty_tier !== "B") return undefined;
  const where = r.address?.locality ? ` in ${r.address.locality}` : "";
  const s: string[] = [];
  const own = r.roasts_own_beans === true;
  if (r.specialty_tier === "A") s.push(`${r.name} is a specialty coffee place${where}${own ? " that roasts its own beans" : ""}.`);
  else s.push(`${r.name} is a ${r.food?.focus === "food_led" ? "food-led place" : "place"}${where} that serves specialty coffee${own ? " roasted in house" : ""}.`);
  const roasters = (r.roasters_served ?? []).filter((x: any) => !x.own).map((x: any) => x.name);
  if (roasters.length) s.push(`It serves coffee from ${list(roasters.slice(0, 4))}.`);
  const sv = r.serving ?? {};
  const drinks = [sv.espresso && "espresso drinks", sv.pour_over ? "pour-over filter coffee" : sv.batch_brew ? "batch-brewed filter coffee" : sv.filter && "filter coffee", sv.cold_brew && "cold brew", sv.decaf && "decaf"].filter(Boolean) as string[];
  if (drinks.length) s.push(`The menu includes ${list(drinks)}${sv.plant_milk ? ", with plant-based milk available" : ""}.`);
  const food = [r.food?.breakfast && "breakfast", r.food?.lunch && "lunch"].filter(Boolean) as string[];
  if (food.length) s.push(`It serves ${list(food)}.`);
  if (r.food?.cakes_baked_in_house) s.push("Cakes are baked in house.");
  const extras = [r.sells_beans && "sells beans to take home", r.sells_equipment && "sells brewing equipment", r.offers_courses && "offers courses or cuppings"].filter(Boolean) as string[];
  if (extras.length) s.push(`It also ${list(extras)}.`);
  if (r.open_sunday === true) s.push("It is open on Sundays.");
  let out = s.join(" ");
  while (out.length > 600 && s.length > 1) { s.pop(); out = s.join(" "); }
  return out.length >= 20 ? out : undefined;
}
