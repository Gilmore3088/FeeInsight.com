import { FEE_FAMILIES } from "@/lib/fee-taxonomy";

/** Existing callers keep their defaults. Homepage demos must opt into their own scope. */
export const DEFAULT_LOCAL_MARKET_CATEGORIES = [
  "overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing",
] as const;

/** The approved homepage is multi-category research, not an overdraft or NSF pitch. */
export const HOMEPAGE_MARKET_CATEGORIES = [
  "cashiers_check", "paper_statement", "money_order", "stop_payment",
] as const;

const CATEGORY_KEYS = new Set(Object.values(FEE_FAMILIES).flat());
const ALLOWED_FIELDS = new Set(["institutionId", "categories"]);
const MAX_CATEGORIES = 50;
const MAX_INSTITUTION_ID = 2_147_483_647;

export class LocalMarketRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalMarketRequestError";
  }
}

/** Preserve order and valid zero-dollar data; never substitute a default for invalid input. */
export function resolveLocalMarketCategories(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_LOCAL_MARKET_CATEGORIES];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CATEGORIES) {
    throw new LocalMarketRequestError("Choose at least one fee category from the available list.");
  }
  for (const key of value) {
    if (typeof key !== "string" || !CATEGORY_KEYS.has(key)) {
      throw new LocalMarketRequestError("Choose fee categories from the available list.");
    }
  }
  return [...new Set(value as string[])];
}

function institutionId(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) {
    throw new LocalMarketRequestError("Choose a valid institution.");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_INSTITUTION_ID) {
    throw new LocalMarketRequestError("Choose a valid institution.");
  }
  return id;
}

export interface LocalMarketRequest {
  institutionId: number | null;
  categories: string[];
}

/**
 * A local branch market is not a state/national market. Reject unsupported filters rather
 * than silently ignoring a state, charter, snapshot, evidence-policy or ownership request.
 * This parser is deliberately separate from the general Hamilton/account contract.
 */
export function parseLocalMarketRequest(value: unknown): LocalMarketRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalMarketRequestError("Send an institution and optional fee categories.");
  }
  if (Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new LocalMarketRequestError(
      "This local-competitor request supports institutionId and categories only. Other research filters were not applied.",
    );
  }
  const body = value as Record<string, unknown>;
  return { institutionId: institutionId(body.institutionId), categories: resolveLocalMarketCategories(body.categories) };
}

/**
 * Adapter for the approved demo's local-comparison CTA. It requires an explicit research
 * subject and defaults to all four homepage categories, never to legacy headline fees.
 * Frontend owners must wire this into the existing Ask transport before advertising it.
 */
export function homepageLocalMarketRequest(
  selectedInstitutionId: number,
  categories: readonly string[] = HOMEPAGE_MARKET_CATEGORIES,
): LocalMarketRequest {
  const request = parseLocalMarketRequest({ institutionId: selectedInstitutionId, categories });
  if (request.institutionId === null) throw new LocalMarketRequestError("Choose an institution first.");
  return request;
}

/** Defense in depth: downstream readers cannot leak unrequested categories into the result. */
export function selectMarketFees(fees: Record<string, number>, categories: readonly string[]): Record<string, number> {
  const selected: Record<string, number> = {};
  for (const category of categories) {
    const amount = fees[category];
    if (Object.prototype.hasOwnProperty.call(fees, category) && Number.isFinite(amount)) selected[category] = amount;
  }
  return selected;
}
