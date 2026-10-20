import { checkValues, flaggedOnly, type KeyValueReport, type ValueCheckInput } from "./data-checks";
import { registryFetchJson, RegistryHttpError, type RegistryFetchOptions } from "./http";

/**
 * Market-value proxies for listed bank holding companies from SEC XBRL company facts
 * (data.sec.gov/api/xbrl/companyfacts, free, no key). Pure: fetches and parses; never writes.
 *
 *   dei:EntityPublicFloat                      aggregate market value of common equity held by
 *                                              non-affiliates, as of the last business day of the
 *                                              filer's second fiscal quarter (10-K cover), USD
 *   dei:EntityCommonStockSharesOutstanding     shares outstanding as of the cover date of each
 *                                              10-K / 10-Q, shares
 *
 * Neither is a daily market capitalisation: public float excludes affiliates' holdings and is
 * measured once a year. Values are stored exactly as filed. Company facts carry no dimensional
 * facts, so a filer with several share classes may report only the undimensioned total or none;
 * that is reported, not filled.
 *
 * Concept names and units are from memory of SEC's dei taxonomy (the site is not reachable from
 * where this was written): each run checks the concept is present with the expected unit and a
 * label that says what it should, and reports what it did not find.
 */

export const SEC_COMPANY_FACTS_URL = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).replace(/\D/g, "").padStart(10, "0")}.json`;

export const SEC_MARKET_CONCEPTS = {
  EntityPublicFloat: { unit: "USD", label: /public float|market value/i },
  EntityCommonStockSharesOutstanding: { unit: "shares", label: /shares outstanding|outstanding/i },
} as const;
export type SecMarketConcept = keyof typeof SEC_MARKET_CONCEPTS;

export interface SecMarketFact {
  concept: SecMarketConcept;
  label: string | null;
  description: string | null;
  unit: string;
  periodEnd: string;
  value: number;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  frame: string | null;
  accession: string | null;
  form: string | null;
  filed: string | null;
}

interface FactEntry {
  end?: string;
  val?: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

export interface CompanyFactsBody {
  cik?: number | string;
  entityName?: string;
  facts?: Record<string, Record<string, { label?: string; description?: string; units?: Record<string, FactEntry[]> }>>;
}

export interface SecMarketRead {
  entityName: string | null;
  facts: SecMarketFact[];
  /** "dei:EntityPublicFloat" when the filer does not tag it; "dei:...:unit:USD" when the unit is absent. */
  missingFields: string[];
  /** Concepts whose label did not read as expected (kept, reported). */
  labelMismatches: string[];
  /** Units found under a concept other than the expected one (not read). */
  unexpectedUnits: string[];
  /** Same concept and date in several filings: the latest filed is kept. */
  repeatedDates: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One value per concept and as-of date, the most recently filed; nothing outside the expected unit. */
export function parseSecMarketFacts(body: CompanyFactsBody): SecMarketRead {
  const dei = body.facts?.dei ?? {};
  const out: SecMarketRead = { entityName: body.entityName ?? null, facts: [], missingFields: [], labelMismatches: [], unexpectedUnits: [], repeatedDates: 0 };
  for (const [concept, spec] of Object.entries(SEC_MARKET_CONCEPTS) as Array<[SecMarketConcept, (typeof SEC_MARKET_CONCEPTS)[SecMarketConcept]]>) {
    const fact = dei[concept];
    if (!fact) {
      out.missingFields.push(`dei:${concept}`);
      continue;
    }
    const label = fact.label?.trim() || null;
    if (!label || !spec.label.test(label)) out.labelMismatches.push(`dei:${concept}: ${label ?? "(no label)"}`);
    for (const unit of Object.keys(fact.units ?? {})) if (unit !== spec.unit) out.unexpectedUnits.push(`dei:${concept}:${unit}`);
    const entries = fact.units?.[spec.unit];
    if (!entries) {
      out.missingFields.push(`dei:${concept}:unit:${spec.unit}`);
      continue;
    }
    const byDate = new Map<string, SecMarketFact>();
    for (const e of entries) {
      if (!e.end || !ISO_DATE.test(e.end) || typeof e.val !== "number" || !Number.isFinite(e.val)) continue;
      const fact1: SecMarketFact = {
        concept,
        label,
        description: fact.description?.trim() || null,
        unit: spec.unit,
        periodEnd: e.end,
        value: e.val,
        fiscalYear: typeof e.fy === "number" ? e.fy : null,
        fiscalPeriod: e.fp ?? null,
        frame: e.frame ?? null,
        accession: e.accn ?? null,
        form: e.form ?? null,
        filed: e.filed && ISO_DATE.test(e.filed) ? e.filed : null,
      };
      const prev = byDate.get(e.end);
      if (prev) {
        out.repeatedDates += 1;
        if ((fact1.filed ?? "") < (prev.filed ?? "")) continue;
      }
      byDate.set(e.end, fact1);
    }
    out.facts.push(...[...byDate.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)));
  }
  return out;
}

export async function fetchSecMarketFacts(cik: string, options: RegistryFetchOptions = {}): Promise<{ url: string; read: SecMarketRead } | null> {
  const url = SEC_COMPANY_FACTS_URL(cik);
  try {
    return { url, read: parseSecMarketFacts(await registryFetchJson<CompanyFactsBody>(url, { timeoutMs: 90_000, ...options })) };
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return null;
    throw error;
  }
}

export interface SecMarketChecks {
  facts: number;
  filers: number;
  byConcept: Record<string, number>;
  /** Filers with no value for a concept. */
  filersMissing: Record<string, number>;
  /** Zero values (a public float of $0 is possible for a company with no non-affiliate holders, but rare). */
  zeroValues: number;
  /** Negative values or values far above the rest, per concept. */
  flagged: KeyValueReport[];
}

/** Reports gaps and outliers; never changes, drops or fills a value. */
export function checkSecMarketFacts(byCik: Array<{ cik: string; facts: SecMarketFact[] }>): SecMarketChecks {
  const byConcept: Record<string, number> = {};
  const filersMissing: Record<string, number> = {};
  let zeroValues = 0;
  const values: ValueCheckInput[] = [];
  for (const { cik, facts } of byCik) {
    for (const concept of Object.keys(SEC_MARKET_CONCEPTS)) {
      if (!facts.some((f) => f.concept === concept)) filersMissing[concept] = (filersMissing[concept] ?? 0) + 1;
    }
    for (const f of facts) {
      byConcept[f.concept] = (byConcept[f.concept] ?? 0) + 1;
      if (f.value === 0) zeroValues += 1;
      values.push({ key: f.concept, id: `${cik}@${f.periodEnd}`, value: f.value });
    }
  }
  return {
    facts: values.length,
    filers: byCik.length,
    byConcept,
    filersMissing,
    zeroValues,
    flagged: flaggedOnly(checkValues(values)),
  };
}
