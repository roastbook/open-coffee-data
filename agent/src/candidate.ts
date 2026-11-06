// A candidate is everything discovery knows about one place before enrichment. Values carry where they came from;
// that run log stays in .cache and the PR body, never in the dataset.
export type Origin = { via: string; url?: string; ref?: string; quote?: string };
export type Candidate = {
  key: string;
  name: string;
  lat?: number; lon?: number;
  street?: string; postcode?: string;
  website?: string; instagram?: string;
  overtureIds: string[];
  overtureStatus?: string | null;
  overtureCoffee?: boolean;
  category?: string | null;
  brand?: string | null;
  wikidata?: string; image?: string;
  origins: Origin[];
};
