// A candidate is everything discovery knows about one place before enrichment. Values carry where they came from;
// that run log stays in .cache and the PR body, never in the dataset.
export interface Origin { via: string; url?: string; ref?: string; quote?: string }
export interface Candidate {
  key: string;
  name: string;
  lat?: number; lon?: number;
  street?: string; postcode?: string;
  website?: string; instagram?: string;
  altWebsites?: string[]; socials?: string[];
  recordName?: string; recordWebsite?: string; // the stored record's, when there is one
  geoUrl?: string; geoVia?: string;
  overtureIds: string[];
  overtureStatus?: string | null;
  overtureCoffee?: boolean;
  category?: string | null;
  brand?: string | null;
  wikidata?: string; image?: string;
  origins: Origin[];
}
