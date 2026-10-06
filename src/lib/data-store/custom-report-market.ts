import { sql } from "./connection";
import { FEE_LINE_RULES } from "@/lib/custom-report/rules";
import { checkFeeAgainstSource, type SourceCheckFailure } from "@/lib/custom-report/source-check";

/**
 * Live data for an automatic Competitive Fee Position Report: the institution, its local
 * market (FDIC Summary of Deposits counties) and every competitor in that market, with one
 * representative published amount per headline fee line.
 *
 * Market: the 3 counties holding most of the institution's deposits; for institutions
 * outside the SOD (credit unions), the counties of SOD branches in its headquarters city.
 * Competitors: every institution with a branch in those counties, plus institutions
 * headquartered in a city that has an SOD branch there (so local credit unions count).
 * Fees: a published row counts only when the institution's own stored source text states it
 * (src/lib/custom-report/source-check.ts); rows that fail are dropped and counted.
 */

export const MAX_MARKET_COUNTIES = 3;
const SOD_THOUSANDS = 1_000;

export interface MarketInstitution {
  institution_id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  /** Deposits held in the market counties, whole dollars; null when not in the SOD. */
  market_deposits: number | null;
}

export interface MarketFeeLine {
  institution_id: number;
  line: string;
  amount: number;
  fee_name: string;
  source_url: string | null;
  updated_at: string | null;
  /** The line of the bank's own document that states this fee. */
  source_line: string;
  /**
   * Every checked amount the institution states for this fee line, representative first,
   * when there is more than one (balance tiers, or two separate charges).
   */
  tiers?: { amount: number; fee_name: string; source_line: string }[];
}

export interface CustomReportMarketData {
  subject: MarketInstitution & { asset_size: number | null };
  market: { basis: "branch_counties" | "hq_city"; county_fips: string[]; places: string[]; sod_year: number } | null;
  competitors: MarketInstitution[];
  /** Representative line per institution and fee line, subject included. */
  lines: MarketFeeLine[];
  /** Published rows left out because their source text does not state them, by reason. */
  dropped: Partial<Record<SourceCheckFailure, number>>;
}

interface StoredText {
  text: string;
  url: string | null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const RULES_JSON = JSON.stringify(
  FEE_LINE_RULES.map((rule) => ({
    k: rule.key,
    source_keys: rule.sourceKeys,
    inc: rule.include,
    exc: rule.exclude,
    lo: rule.lo,
    hi: rule.hi,
    allow_zero: rule.allowZero,
  })),
);

export async function getCustomReportMarketData(institutionId: number): Promise<CustomReportMarketData | null> {
  const [subject] = await sql<
    { id: number; institution_name: string; city: string | null; state_code: string | null; charter_type: string | null; cert_number: string | null; asset_size: string | null }[]
  >`
    SELECT id, institution_name, city, state_code, charter_type, cert_number::text AS cert_number, asset_size
    FROM institution_sources WHERE id = ${institutionId}`;
  if (!subject) return null;

  const counties = await sql<{ county_fips: string; year: number; city: string; state: string; basis: string }[]>`
    WITH latest AS (SELECT MAX(year) AS y FROM institution_branch_deposits),
    own_all AS (
      SELECT b.county_fips::text AS county_fips, b.year, MIN(b.city) AS city, MIN(b.state) AS state,
             SUM(COALESCE(b.deposits, 0)) AS deposits
      FROM institution_branch_deposits b, latest
      WHERE ${subject.cert_number}::text IS NOT NULL AND b.cert::text = ${subject.cert_number}::text
        AND b.year = latest.y AND b.county_fips IS NOT NULL
      GROUP BY b.county_fips, b.year
    ),
    -- The local market stays in the state of the county holding the most deposits.
    own AS (
      SELECT * FROM own_all
      WHERE state = (SELECT state FROM own_all ORDER BY deposits DESC LIMIT 1)
      ORDER BY deposits DESC
      LIMIT ${MAX_MARKET_COUNTIES}
    ),
    hq AS (
      SELECT DISTINCT b.county_fips::text AS county_fips, b.year, MIN(b.city) AS city, MIN(b.state) AS state
      FROM institution_branch_deposits b, latest
      WHERE NOT EXISTS (SELECT 1 FROM own)
        AND b.year = latest.y AND b.state = ${subject.state_code} AND UPPER(b.city) = UPPER(${subject.city ?? ""})
        AND b.county_fips IS NOT NULL
      GROUP BY b.county_fips, b.year
      LIMIT ${MAX_MARKET_COUNTIES}
    )
    SELECT county_fips, year, city, state, 'branch_counties' AS basis FROM own
    UNION ALL
    SELECT county_fips, year, city, state, 'hq_city' AS basis FROM hq`;

  const subjectRow = {
    institution_id: Number(subject.id),
    institution_name: subject.institution_name,
    city: subject.city,
    state_code: subject.state_code,
    charter_type: subject.charter_type,
    market_deposits: null,
    asset_size: num(subject.asset_size),
  };
  if (counties.length === 0) return { subject: subjectRow, market: null, competitors: [], lines: [], dropped: {} };

  const countyFips = counties.map((row) => String(row.county_fips));
  const sodYear = Number(counties[0].year);

  const rows = await sql<
    {
      institution_id: number;
      institution_name: string;
      city: string | null;
      state_code: string | null;
      charter_type: string | null;
      market_deposits: string | null;
      line: string | null;
      amount: string | null;
      fee_name: string | null;
      source_url: string | null;
      updated_at: string | null;
      source_document_id: string | null;
    }[]
  >`
    WITH rules AS (
      SELECT * FROM jsonb_to_recordset(${RULES_JSON}::jsonb)
        AS r(k text, source_keys text[], inc text, exc text, lo numeric, hi numeric, allow_zero boolean)
    ),
    branches AS (
      SELECT b.institution_id, b.state, UPPER(b.city) AS city, COALESCE(b.deposits, 0) AS deposits
      FROM institution_branch_deposits b
      WHERE b.year = ${sodYear} AND b.county_fips::text = ANY(${countyFips})
    ),
    rivals AS (
      SELECT institution_id, SUM(deposits) AS deposits FROM branches
      WHERE institution_id IS NOT NULL GROUP BY institution_id
      UNION
      SELECT s.id, NULL FROM institution_sources s
      WHERE EXISTS (SELECT 1 FROM branches p WHERE p.state = s.state_code AND p.city = UPPER(s.city))
        AND NOT EXISTS (SELECT 1 FROM branches b2 WHERE b2.institution_id = s.id)
    ),
    members AS (
      SELECT institution_id, MAX(deposits) AS deposits FROM rivals GROUP BY institution_id
      UNION
      SELECT ${institutionId}::bigint, NULL WHERE NOT EXISTS (SELECT 1 FROM rivals WHERE institution_id = ${institutionId})
    ),
    guarded AS (
      SELECT c.institution_id, r.k AS line, c.amount, c.fee_name, c.source_document_id,
             COALESCE(c.document_url, c.source_url) AS source_url, c.updated_at
      FROM published_fee_catalog c
      JOIN rules r ON c.canonical_fee_key = ANY (r.source_keys)
      WHERE c.institution_id IN (SELECT institution_id FROM members)
        AND c.review_status = 'approved'
        AND c.amount IS NOT NULL
        AND COALESCE(c.is_fee_cap, false) = false
        AND c.fee_name ~* r.inc AND c.fee_name !~* r.exc
        AND ((c.amount BETWEEN r.lo AND r.hi AND c.amount > 0) OR (c.amount = 0 AND r.allow_zero))
    ),
    -- Every candidate, in preference order; the first one its source text supports is used.
    ranked AS (
      SELECT g.*, row_number() OVER (
               PARTITION BY institution_id, line
               ORDER BY (amount = 0),
                        (fee_name ~* '(online|mobile|internet|electronic|trace|business|commercial|cash management|renewal|\\mach\\M|\\mvia\\M|initiated|fax|recurring)'),
                        length(fee_name),
                        CASE WHEN line = 'monthly_maintenance' THEN amount ELSE -amount END) AS pref
      FROM guarded g
    )
    SELECT m.institution_id, s.institution_name, s.city, s.state_code, s.charter_type,
           m.deposits AS market_deposits, p.line, p.amount, p.fee_name, p.source_url, p.updated_at::text AS updated_at,
           p.source_document_id::text AS source_document_id
    FROM members m
    JOIN institution_sources s ON s.id = m.institution_id
    LEFT JOIN ranked p ON p.institution_id = m.institution_id
    ORDER BY m.institution_id, p.line, p.pref`;

  // Each fee is checked against its own document's stored text. Fees carried over from the
  // pre-agent migration have no document link, so they are checked against the
  // institution's own stored schedules instead; either way the text is the bank's own.
  const documentIds = [...new Set(rows.map((row) => row.source_document_id).filter((id): id is string => Boolean(id)))];
  const unlinkedInstitutions = [
    ...new Set(rows.filter((row) => row.line && !row.source_document_id).map((row) => Number(row.institution_id))),
  ];
  const texts = new Map<string, StoredText>();
  const textsByInstitution = new Map<number, StoredText[]>();
  if (documentIds.length > 0 || unlinkedInstitutions.length > 0) {
    const textRows = await sql<
      { source_document_id: string; institution_id: number; source_url: string | null; normalized_text: string | null }[]
    >`
      SELECT DISTINCT ON (source_document_id) source_document_id::text AS source_document_id, institution_id,
             source_url, normalized_text
      FROM agent_source_texts
      WHERE status = 'completed'
        AND (source_document_id::text = ANY(${documentIds}) OR institution_id = ANY(${unlinkedInstitutions}))
      ORDER BY source_document_id, updated_at DESC NULLS LAST, id DESC`;
    for (const row of textRows) {
      if (!row.normalized_text) continue;
      const stored = { text: row.normalized_text, url: row.source_url };
      texts.set(row.source_document_id, stored);
      const id = Number(row.institution_id);
      textsByInstitution.set(id, [...(textsByInstitution.get(id) ?? []), stored]);
    }
  }
  const includeByLine = new Map(FEE_LINE_RULES.map((rule) => [rule.key, rule.include]));
  const filled = new Map<string, MarketFeeLine>();
  const dropped: Partial<Record<SourceCheckFailure, number>> = {};

  const competitors = new Map<number, MarketInstitution>();
  const lines: MarketFeeLine[] = [];
  for (const row of rows) {
    const id = Number(row.institution_id);
    if (id !== subjectRow.institution_id && !competitors.has(id)) {
      const deposits = num(row.market_deposits);
      competitors.set(id, {
        institution_id: id,
        institution_name: row.institution_name,
        city: row.city,
        state_code: row.state_code,
        charter_type: row.charter_type,
        market_deposits: deposits === null ? null : deposits * SOD_THOUSANDS,
      });
    }
    const amount = num(row.amount);
    const slot = `${id}:${row.line}`;
    if (row.line && amount !== null && row.fee_name) {
      const linked = row.source_document_id ? texts.get(row.source_document_id) : undefined;
      const candidates = linked ? [linked] : row.source_document_id ? [] : (textsByInstitution.get(id) ?? []);
      const include = includeByLine.get(row.line) ?? "";
      let check: ReturnType<typeof checkFeeAgainstSource> = { ok: false, reason: "no_source_text" };
      let source: StoredText | null = null;
      for (const candidate of candidates) {
        check = checkFeeAgainstSource(candidate.text, row.fee_name, amount, include);
        if (check.ok) {
          source = candidate;
          break;
        }
      }
      if (!check.ok) {
        dropped[check.reason] = (dropped[check.reason] ?? 0) + 1;
        continue;
      }
      const representative = filled.get(slot);
      if (representative) {
        // Further checked amounts for the same line are shown as tiers, not compared.
        const tiers = representative.tiers ?? [
          { amount: representative.amount, fee_name: representative.fee_name, source_line: representative.source_line },
        ];
        if (!tiers.some((tier) => tier.amount === amount && tier.source_line === check.sourceLine)) {
          representative.tiers = [...tiers, { amount, fee_name: row.fee_name, source_line: check.sourceLine }];
        }
        continue;
      }
      const entry: MarketFeeLine = {
        institution_id: id,
        line: row.line,
        amount,
        fee_name: row.fee_name,
        source_url: row.source_url ?? source?.url ?? null,
        updated_at: row.updated_at ? row.updated_at.slice(0, 10) : null,
        source_line: check.sourceLine,
      };
      filled.set(slot, entry);
      lines.push(entry);
    }
  }

  return {
    subject: subjectRow,
    market: {
      basis: counties[0].basis === "hq_city" ? "hq_city" : "branch_counties",
      county_fips: countyFips,
      places: [...new Set(counties.map((row) => `${row.city}, ${row.state}`))],
      sod_year: sodYear,
    },
    competitors: [...competitors.values()],
    lines,
    dropped,
  };
}

const NAME_TOKEN_EXPANSIONS: Record<string, string> = {
  fcu: "federal credit union",
  cu: "credit union",
  natl: "national",
  nat: "national",
  bk: "bank",
  svgs: "savings",
  sb: "savings bank",
};
const LEGAL_SUFFIXES = new Set(["na", "inc", "co", "corp", "company", "corporation", "ltd", "llc"]);
const GENERIC_NAME_TOKENS = new Set([
  "bank", "credit", "union", "federal", "national", "first", "savings", "trust", "the", "and", "of",
  "community", "state", "citizens", "farmers", "merchants", "peoples", "security", "home", "american",
]);

/**
 * Folds the ways people type an institution's name onto one form: case, punctuation,
 * "&" vs "and", a leading "The", legal suffixes (N.A., Inc.) and common abbreviations
 * (FCU, CU). "The First National Bank of Elk City, N.A." and "first national bank of elk city"
 * normalize the same.
 */
export function normalizeInstitutionName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .flatMap((token) => (NAME_TOKEN_EXPANSIONS[token] ?? token).split(" "));
  if (tokens[0] === "the") tokens.shift();
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

/** The most distinctive word of a normalized name, used to narrow the lookup. */
function distinctiveToken(normalized: string): string | null {
  const tokens = normalized.split(" ").filter((t) => t.length >= 3);
  const specific = tokens.filter((t) => !GENERIC_NAME_TOKENS.has(t));
  const pool = specific.length > 0 ? specific : tokens;
  return pool.sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * The institution a free-text name refers to, only when exactly one name matches: first
 * exactly (ignoring case), then after normalizeInstitutionName on both sides. Two or more
 * matches stay unmatched, so James looks it up rather than quoting the wrong institution.
 */
export async function findInstitutionIdByName(name: string): Promise<number | null> {
  const trimmed = name.trim();
  if (trimmed.length < 3) return null;
  const exact = await sql<{ id: number }[]>`
    SELECT id FROM institution_sources WHERE lower(institution_name) = lower(${trimmed}) LIMIT 2`;
  if (exact.length === 1) return Number(exact[0].id);
  if (exact.length > 1) return null;

  const wanted = normalizeInstitutionName(trimmed);
  const token = distinctiveToken(wanted);
  if (!token) return null;
  const candidates = await sql<{ id: number; institution_name: string }[]>`
    SELECT id, institution_name FROM institution_sources
    WHERE institution_name ILIKE ${"%" + token + "%"}
    LIMIT 2000`;
  const matches = candidates.filter((row) => normalizeInstitutionName(row.institution_name) === wanted);
  return matches.length === 1 ? Number(matches[0].id) : null;
}
