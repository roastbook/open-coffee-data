// Field labels for the Explorer, in the order of the coffee-places schema v0.1.0.
export const SERVING: [string, string][] = [
  ["espresso", "Espresso"], ["filter", "Filter coffee"], ["pour_over", "Pour-over"], ["batch_brew", "Batch brew"],
  ["cold_brew", "Cold brew"], ["decaf", "Decaf"], ["plant_milk", "Plant milk"],
];
export const AMENITIES: [string, string][] = [
  ["wifi", "Wi-Fi"], ["laptop_friendly", "Laptop-friendly"], ["kids_friendly", "Kids welcome"], ["vegan_options", "Vegan food"],
  ["dogs_allowed", "Dogs allowed"], ["outdoor_seating", "Outdoor seating"], ["card_payment", "Card payment"], ["cash_only", "Cash only"],
  ["wheelchair_accessible", "Step-free entrance"],
];
export const LABELS: Partial<Record<string, string>> = {
  id: "Id", type: "Type", name: "Name", status: "Status", merged_into: "Merged into", opened_on: "Opened", closed_on: "Closed",
  last_verified_at: "Last verified", checked_at: "Checked", address: "Address", "address.street_address": "Street",
  "address.postal_code": "Postal code", "address.locality": "City", "address.region": "Region", "address.country_code": "Country",
  location: "Coordinates", opening_hours: "Opening hours", description: "Description",
  specialty_tier: "Specialty tier", roasts_own_beans: "Roasts own beans",
  roasters_served: "Roasters served", serving: "Serving", amenities: "Amenities", food: "Food", "food.focus": "Food focus",
  "food.breakfast": "Breakfast", "food.lunch": "Lunch", "food.cakes_baked_in_house": "Cakes baked in house",
  sells_beans: "Sells beans", sells_equipment: "Sells equipment", offers_courses: "Courses and cuppings",
  reusable_cup_systems: "Reusable cups", good_for: "Good for", awards: "Awards", prices: "Prices",
  "prices.cappuccino": "Cappuccino price", operator: "Operator", links: "Links", "links.website": "Website",
  "links.instagram": "Instagram", "links.facebook": "Facebook", image: "Image", xref: "Other datasets",
  "xref.overture": "Overture id", "xref.foursquare": "Foursquare id", "xref.wikidata": "Wikidata", "xref.google_place_id": "Google place id",
  external_ratings: "Ratings elsewhere",
  ...Object.fromEntries(SERVING.map(([k, l]) => [`serving.${k}`, l])),
  ...Object.fromEntries(AMENITIES.map(([k, l]) => [`amenities.${k}`, l])),
};
export const TIER_LABEL: Partial<Record<string, string>> = { A: "A · specialty-focused", B: "B · serves specialty", none: "Not specialty" };
export const STATUS_LABEL: Partial<Record<string, string>> = { open: "Open", temporarily_closed: "Temporarily closed", closed: "Closed", unverified: "Unverified" };
