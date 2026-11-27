export interface StrictJsonBounds {
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxStringLength?: number;
  maxCollectionEntries?: number;
}
/** JSON data only; duplicate decoded keys, invalid UTF-8 and non-finite numbers throw. */
export function parseStrictJson(input: string | Uint8Array, options?: StrictJsonBounds): unknown;
