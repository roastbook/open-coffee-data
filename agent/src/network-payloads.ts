import {
  payloadParser,
  stringValue,
  numberValue,
  stringArray,
  optionalText,
} from "./payload";

interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}
interface ModelOutput {
  type: string;
  content?: { text?: string }[];
}
interface ModelReply {
  usage?: TokenUsage;
  choices?: { message?: { content?: string | null } }[];
  output?: ModelOutput[];
}
export const modelReply = payloadParser<ModelReply>({
  type: "object",
  properties: {
    usage: {
      type: "object",
      properties: {
        prompt_tokens: numberValue,
        completion_tokens: numberValue,
        input_tokens: numberValue,
        output_tokens: numberValue,
      },
    },
    choices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          message: { type: "object", properties: { content: optionalText } },
        },
      },
    },
    output: {
      type: "array",
      items: {
        type: "object",
        required: ["type"],
        properties: {
          type: stringValue,
          content: {
            type: "array",
            items: { type: "object", properties: { text: stringValue } },
          },
        },
      },
    },
  },
});

interface SparqlValue {
  value: string;
}
interface CafeBinding {
  p: SparqlValue;
  pLabel: SparqlValue;
  coord: SparqlValue;
  site?: SparqlValue;
  img?: SparqlValue;
  end?: SparqlValue;
}
interface DistrictBinding {
  d: SparqlValue;
  dLabel: SparqlValue;
}
const bindingValue = {
  type: "object",
  required: ["value"],
  properties: { value: stringValue },
};
const sparqlSchema = (required: string[], properties: object) => ({
  type: "object",
  required: ["results"],
  properties: {
    results: {
      type: "object",
      required: ["bindings"],
      properties: {
        bindings: {
          type: "array",
          items: { type: "object", required, properties },
        },
      },
    },
  },
});
export const cafeBindings = payloadParser<{
  results: { bindings: CafeBinding[] };
}>(
  sparqlSchema(["p", "pLabel", "coord"], {
    p: bindingValue,
    pLabel: bindingValue,
    coord: bindingValue,
    site: bindingValue,
    img: bindingValue,
    end: bindingValue,
  }),
);
export const districtBindings = payloadParser<{
  results: { bindings: DistrictBinding[] };
}>(sparqlSchema(["d", "dLabel"], { d: bindingValue, dLabel: bindingValue }));

interface SearchHit {
  url: string;
  title?: string;
  description?: string;
  content?: string;
}
const searchHits = {
  type: "array",
  items: {
    type: "object",
    required: ["url"],
    properties: {
      url: stringValue,
      title: stringValue,
      description: stringValue,
      content: stringValue,
    },
  },
};
export const searchReply = payloadParser<{
  web?: { results?: SearchHit[] };
  results?: SearchHit[];
}>({
  type: "object",
  properties: {
    web: { type: "object", properties: { results: searchHits } },
    results: searchHits,
  },
});
export const ownSites = payloadParser<{ own_site?: string[] }>({
  type: "object",
  properties: { own_site: stringArray },
});
export const placeLeads = payloadParser<{
  places?: { name: string; website?: string | null }[];
}>({
  type: "object",
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: { name: stringValue, website: optionalText },
      },
    },
  },
});
