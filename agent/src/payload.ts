import { Ajv, type ValidateFunction } from "ajv";

const ajv = new Ajv({ strict: false, allErrors: true });

/** Validate external JSON before it becomes a domain value. */
export function payloadParser<T>(schema: object): (value: unknown) => T {
  const validate: ValidateFunction<T> = ajv.compile<T>(schema);
  return (value: unknown): T => {
    if (!validate(value))
      throw new Error(`Invalid payload: ${ajv.errorsText(validate.errors)}`);
    return value;
  };
}

export const stringValue = { type: "string" };
export const numberValue = { type: "number" };
export const stringArray = { type: "array", items: stringValue };
export const optionalText = { type: ["string", "null"] };

/** Validate list entries independently so a malformed sibling cannot discard valid results. */
export function payloadItems<T>(schema: object) {
  const validate: ValidateFunction<T> = ajv.compile<T>(schema);
  return (values: unknown[]): T[] => values.filter((value): value is T => validate(value));
}
