import type { NavLink } from "@roastbook/ui/sites";

const ITEMS = [
  ["explorer", "/", "Explorer"],
  ["downloads", "/downloads/", "Downloads"],
  ["brew-methods", "/brew-methods/", "Brew methods"],
  ["pour-patterns", "/pour-patterns/", "Pour patterns"],
  ["kettle-movements", "/kettle-movements/", "Kettle movements"],
] as const;

export type Page = (typeof ITEMS)[number][0];

/** The site's sections for the shared header. */
export const siteNav = (current: Page): NavLink[] => ITEMS.map(([id, href, label]) => ({ href, label, current: id === current }));
