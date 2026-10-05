import { sql } from "./connection";

export interface BeigeBookSection {
  id: number;
  release_date: string;
  release_code: string;
  fed_district: number | null;
  section_name: string;
  content_text: string;
  source_url: string;
}

export async function getLatestBeigeBook(district: number): Promise<BeigeBookSection[]> {
  try {
    const [latest] = await sql`
      SELECT release_code FROM fed_beige_book
      WHERE fed_district = ${district}
      ORDER BY release_code DESC
      LIMIT 1
    `;

    if (!latest) return [];

    const rows = await sql`
      SELECT id, release_date, release_code, fed_district, section_name,
             content_text, source_url
      FROM fed_beige_book
      WHERE fed_district = ${district} AND release_code = ${latest.release_code}
      ORDER BY id
    ` as BeigeBookSection[];

    // Normalize Date objects from Postgres
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
      release_date: (r.release_date as unknown) instanceof Date
        ? (r.release_date as unknown as Date).toISOString().slice(0, 10)
        : String(r.release_date),
    }));
  } catch {
    return [];
  }
}

export async function getBeigeBookEditions(
  limit = 8
): Promise<{ release_code: string; release_date: string }[]> {
  try {
    return await sql`
      SELECT DISTINCT release_code, release_date
      FROM fed_beige_book
      ORDER BY release_code DESC
      LIMIT ${limit}
    ` as { release_code: string; release_date: string }[];
  } catch {
    return [];
  }
}

export async function getBeigeBookHeadline(
  district: number
): Promise<{ text: string; release_date: string } | null> {
  try {
    const [row] = await sql`
      SELECT content_text, release_date
      FROM fed_beige_book
      WHERE fed_district = ${district} AND section_name = 'Summary of Economic Activity'
      ORDER BY release_code DESC
      LIMIT 1
    `;

    if (!row) return null;

    const firstSentence = row.content_text.split(/(?<=[.!?])\s+/)[0] ?? "";
    const text =
      firstSentence.length > 80
        ? firstSentence.slice(0, 77) + "..."
        : firstSentence;

    const releaseDate = row.release_date instanceof Date
      ? row.release_date.toISOString().slice(0, 10)
      : String(row.release_date);
    return { text, release_date: releaseDate };
  } catch {
    return null;
  }
}

export interface FedContentItem {
  id: number;
  content_type: string;
  title: string;
  speaker: string | null;
  fed_district: number | null;
  source_url: string;
  published_at: string;
  description: string | null;
}

export async function getDistrictContent(
  district: number,
  limit = 10
): Promise<FedContentItem[]> {
  try {
    return await sql`
      SELECT id, content_type, title, speaker, fed_district, source_url,
             published_at, description
      FROM fed_content
      WHERE fed_district = ${district}
      ORDER BY published_at DESC
      LIMIT ${limit}
    ` as FedContentItem[];
  } catch {
    return [];
  }
}

export async function getRecentSpeeches(limit = 10): Promise<FedContentItem[]> {
  try {
    return await sql`
      SELECT id, content_type, title, speaker, fed_district, source_url,
             published_at, description
      FROM fed_content
      WHERE content_type IN ('speech', 'testimony')
      ORDER BY published_at DESC
      LIMIT ${limit}
    ` as FedContentItem[];
  } catch {
    return [];
  }
}

export interface EconomicIndicator {
  series_id: string;
  series_title: string | null;
  observation_date: string;
  value: number | null;
  units: string | null;
}

export async function getDistrictIndicators(
  district: number
): Promise<EconomicIndicator[]> {
  try {
    return await sql`
      SELECT series_id, series_title, observation_date, value, units
      FROM fed_economic_indicators
      WHERE fed_district = ${district} OR fed_district IS NULL
      ORDER BY series_id, observation_date DESC
    ` as EconomicIndicator[];
  } catch {
    return [];
  }
}

export async function getBeigeBookHeadlines(): Promise<Map<number, { text: string; release_date: string }>> {
  try {
    const rows = await sql`
      SELECT fed_district, content_text, release_date
      FROM fed_beige_book bb1
      WHERE section_name = 'Summary of Economic Activity'
        AND fed_district IS NOT NULL
        AND release_code = (
          SELECT MAX(bb2.release_code)
          FROM fed_beige_book bb2
          WHERE bb2.fed_district = bb1.fed_district
        )
    ` as { fed_district: number; content_text: string; release_date: string }[];

    const map = new Map<number, { text: string; release_date: string }>();
    for (const row of rows) {
      const firstSentence = row.content_text.split(/(?<=[.!?])\s+/)[0] ?? "";
      const text =
        firstSentence.length > 80
          ? firstSentence.slice(0, 77) + "..."
          : firstSentence;
      map.set(row.fed_district, { text, release_date: row.release_date });
    }
    return map;
  } catch {
    return new Map();
  }
}

// --- Rich Indicator (history + trend for sparklines) ---

export interface RichIndicator {
  current: number;
  history: { date: string; value: number }[];
  trend: "rising" | "falling" | "stable";
  asOf: string;
}

export interface NationalEconomicSummary {
  fed_funds_rate: RichIndicator | null;
  unemployment_rate: RichIndicator | null;
  cpi_yoy_pct: RichIndicator | null;
  consumer_sentiment: RichIndicator | null;
}

export interface DistrictBeigeBookSummary {
  district_number: number;
  district_name: string;
  summary: string;
  themes: string[];
  release_date: string;
}

const DISTRICT_NAMES: Record<number, string> = {
  1: "Boston",
  2: "New York",
  3: "Philadelphia",
  4: "Cleveland",
  5: "Richmond",
  6: "Atlanta",
  7: "Chicago",
  8: "St. Louis",
  9: "Minneapolis",
  10: "Kansas City",
  11: "Dallas",
  12: "San Francisco",
};

async function buildRichIndicator(
  seriesId: string,
  historyLimit = 12
): Promise<RichIndicator | null> {
  try {
    const rows = await sql`
      SELECT observation_date, value
      FROM fed_economic_indicators
      WHERE series_id = ${seriesId}
        AND value IS NOT NULL
      ORDER BY observation_date DESC
      LIMIT ${historyLimit}
    ` as { observation_date: string | Date; value: number | string }[];

    if (rows.length === 0) return null;

    const parsed = rows.map((r) => ({
      date: r.observation_date instanceof Date
        ? r.observation_date.toISOString().slice(0, 10)
        : String(r.observation_date),
      value: Number(r.value),
    }));

    const current = parsed[0].value;
    const asOf = parsed[0].date;

    let trend: "rising" | "falling" | "stable" = "stable";
    if (parsed.length >= 3) {
      const recent = parsed.slice(0, 3).reduce((sum, p) => sum + p.value, 0) / 3;
      const older = parsed.slice(-3).reduce((sum, p) => sum + p.value, 0) / 3;
      const delta = recent - older;
      if (Math.abs(delta) < 0.05 * Math.abs(older || 1)) {
        trend = "stable";
      } else {
        trend = delta > 0 ? "rising" : "falling";
      }
    }

    return { current, history: parsed, trend, asOf };
  } catch {
    return null;
  }
}

export async function getNationalEconomicSummary(): Promise<NationalEconomicSummary> {
  const [fedFunds, unemployment, cpiRows, consumerSentiment] = await Promise.all([
    buildRichIndicator("FEDFUNDS"),
    buildRichIndicator("UNRATE"),
    (async (): Promise<RichIndicator | null> => {
      // CPI YoY: compute rolling 12-month change from index levels
      try {
        const rows = await sql`
          SELECT observation_date, value
          FROM fed_economic_indicators
          WHERE series_id = 'CPIAUCSL' AND value IS NOT NULL
          ORDER BY observation_date DESC
          LIMIT 24
        ` as { observation_date: string | Date; value: number | string }[];

        if (rows.length < 13) return null;

        const parsed = rows.map((r) => ({
          date: r.observation_date instanceof Date
            ? r.observation_date.toISOString().slice(0, 10)
            : String(r.observation_date),
          value: Number(r.value),
        }));

        // Build YoY history for up to 12 points
        const yoyHistory: { date: string; value: number }[] = [];
        for (let i = 0; i < parsed.length - 12; i++) {
          const current = parsed[i].value;
          const prior = parsed[i + 12].value;
          if (prior > 0) {
            yoyHistory.push({
              date: parsed[i].date,
              value: ((current - prior) / prior) * 100,
            });
          }
        }

        if (yoyHistory.length === 0) return null;

        const current = yoyHistory[0].value;
        const asOf = yoyHistory[0].date;

        let trend: "rising" | "falling" | "stable" = "stable";
        if (yoyHistory.length >= 3) {
          const delta = yoyHistory[0].value - yoyHistory[Math.min(2, yoyHistory.length - 1)].value;
          trend = Math.abs(delta) < 0.1 ? "stable" : delta > 0 ? "rising" : "falling";
        }

        return { current, history: yoyHistory, trend, asOf };
      } catch {
        return null;
      }
    })(),
    buildRichIndicator("UMCSENT"),
  ]);

  return {
    fed_funds_rate: fedFunds,
    unemployment_rate: unemployment,
    cpi_yoy_pct: cpiRows,
    consumer_sentiment: consumerSentiment,
  };
}

export async function getDistrictBeigeBookSummaries(
  limit = 12
): Promise<DistrictBeigeBookSummary[]> {
  try {
    // Fetch the latest Beige Book summary section per district
    const rows = await sql`
      SELECT DISTINCT ON (bb.fed_district)
        bb.fed_district,
        bb.content_text,
        bb.release_date
      FROM fed_beige_book bb
      WHERE bb.section_name = 'Summary of Economic Activity'
        AND bb.fed_district IS NOT NULL
      ORDER BY bb.fed_district, bb.release_code DESC
      LIMIT ${limit}
    ` as { fed_district: number; content_text: string; release_date: string | Date }[];

    return rows.map((row) => {
      const districtNum = Number(row.fed_district);
      const districtName = DISTRICT_NAMES[districtNum] ?? `District ${districtNum}`;

      // Truncate summary to ~300 chars
      const fullText = row.content_text ?? "";
      const summary = fullText.length > 300
        ? fullText.slice(0, 297) + "..."
        : fullText;

      // Extract simple themes from first few sentences (keywords)
      const themes: string[] = [];
      const lc = fullText.toLowerCase();
      if (lc.includes("employment") || lc.includes("labor")) themes.push("Labor Market");
      if (lc.includes("inflation") || lc.includes("prices")) themes.push("Inflation");
      if (lc.includes("consumer") || lc.includes("spending")) themes.push("Consumer Spending");
      if (lc.includes("manufacturing") || lc.includes("industrial")) themes.push("Manufacturing");
      if (lc.includes("real estate") || lc.includes("housing")) themes.push("Real Estate");
      if (lc.includes("lending") || lc.includes("credit") || lc.includes("loan")) themes.push("Credit");
      if (lc.includes("agriculture") || lc.includes("farm")) themes.push("Agriculture");
      if (lc.includes("energy") || lc.includes("oil")) themes.push("Energy");

      const releaseDate = row.release_date instanceof Date
        ? row.release_date.toISOString().slice(0, 10)
        : String(row.release_date);

      return {
        district_number: districtNum,
        district_name: districtName,
        summary,
        themes: themes.slice(0, 4),
        release_date: releaseDate,
      };
    });
  } catch {
    return [];
  }
}

const DISTRICT_UNEMPLOYMENT_SERIES: Record<number, string> = {
  1: "MAUR", 2: "NYUR", 3: "PAUR", 4: "OHUR",
  5: "VAUR", 6: "GAUR", 7: "ILUR", 8: "MOUR",
  9: "MNUR", 10: "COUR", 11: "TXUR", 12: "CAUR",
};

const DISTRICT_PAYROLL_SERIES: Record<number, string> = {
  1: "MANA", 2: "NYNA", 3: "PANA", 4: "OHNA",
  5: "VANA", 6: "GANA", 7: "ILNA", 8: "MONA",
  9: "MNNA", 10: "CONA", 11: "TXNA", 12: "CANA",
};

export interface DistrictEconomicSummary {
  district: number;
  unemployment_rate: RichIndicator | null;
  nonfarm_payroll: RichIndicator | null;
  nonfarm_yoy_pct: number | null;
}

export async function getDistrictEconomicSummary(
  district: number
): Promise<DistrictEconomicSummary> {
  const unemployId = DISTRICT_UNEMPLOYMENT_SERIES[district];
  const payrollId = DISTRICT_PAYROLL_SERIES[district];

  const [unemployment, payroll] = await Promise.all([
    unemployId ? buildRichIndicator(unemployId) : Promise.resolve(null),
    payrollId ? buildRichIndicator(payrollId, 13) : Promise.resolve(null),
  ]);

  let nonfarm_yoy_pct: number | null = null;
  if (payroll && payroll.history.length >= 13) {
    const cur = payroll.history[0].value;
    const prior = payroll.history[12].value;
    if (prior > 0) {
      nonfarm_yoy_pct = ((cur - prior) / prior) * 100;
    }
  }

  return { district, unemployment_rate: unemployment, nonfarm_payroll: payroll, nonfarm_yoy_pct };
}

export interface FredSummary {
  fed_funds_rate: number | null;
  unemployment_rate: number | null;
  cpi_yoy_pct: number | null;
  consumer_sentiment: number | null;
  gdp_growth_yoy_pct: number | null;
  personal_savings_rate: number | null;
  bank_lending_standards: number | null;
  as_of: string;
}

export interface BeigeBookTheme {
  release_code: string;
  fed_district: number;
  district_name: string;
  theme_category: 'growth' | 'employment' | 'prices' | 'lending_conditions';
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  summary: string;
  confidence: number;
  extracted_at: string;
}

export async function getBeigeBookThemes(releaseCode?: string): Promise<BeigeBookTheme[]> {
  try {
    let code = releaseCode;

    if (!code) {
      const [latest] = await sql`
        SELECT release_code FROM beige_book_themes
        ORDER BY extracted_at DESC
        LIMIT 1
      ` as { release_code: string }[];

      if (!latest) return [];
      code = latest.release_code;
    }

    const rows = await sql`
      SELECT release_code, fed_district, theme_category, sentiment,
             summary, confidence, extracted_at
      FROM beige_book_themes
      WHERE release_code = ${code}
      ORDER BY fed_district, theme_category
    ` as {
      release_code: string;
      fed_district: number;
      theme_category: string;
      sentiment: string;
      summary: string;
      confidence: number;
      extracted_at: string | Date;
    }[];

    return rows.map((row) => ({
      release_code: row.release_code,
      fed_district: Number(row.fed_district),
      district_name: DISTRICT_NAMES[Number(row.fed_district)] ?? `District ${row.fed_district}`,
      theme_category: row.theme_category as BeigeBookTheme['theme_category'],
      sentiment: row.sentiment as BeigeBookTheme['sentiment'],
      summary: row.summary,
      confidence: Number(row.confidence),
      extracted_at: row.extracted_at instanceof Date
        ? row.extracted_at.toISOString()
        : String(row.extracted_at),
    }));
  } catch {
    return [];
  }
}

export async function getFredSummary(): Promise<FredSummary> {
  const empty: FredSummary = {
    fed_funds_rate: null,
    unemployment_rate: null,
    cpi_yoy_pct: null,
    consumer_sentiment: null,
    gdp_growth_yoy_pct: null,
    personal_savings_rate: null,
    bank_lending_standards: null,
    as_of: new Date().toISOString().slice(0, 10),
  };

  try {
    const rows = await sql`
      SELECT DISTINCT ON (series_id)
        series_id,
        value,
        observation_date
      FROM fed_economic_indicators
      WHERE series_id IN ('FEDFUNDS', 'UNRATE', 'CPIAUCSL', 'UMCSENT', 'GDPC1', 'PSAVERT', 'DRCBLACBS')
      ORDER BY series_id, observation_date DESC
    ` as { series_id: string; value: number | null; observation_date: string | Date }[];

    const byId = new Map<string, { value: number | null; observation_date: string }>();
    for (const row of rows) {
      const date = row.observation_date instanceof Date
        ? row.observation_date.toISOString().slice(0, 10)
        : String(row.observation_date);
      byId.set(row.series_id, { value: Number(row.value), observation_date: date });
    }

    const dates = Array.from(byId.values()).map((r) => r.observation_date).sort().reverse();
    const as_of = dates[0] ?? empty.as_of;

    // Compute CPI YoY change: compare latest value to 12 months prior
    let cpiYoy: number | null = null;
    try {
      const cpiRows = await sql`
        SELECT value, observation_date
        FROM fed_economic_indicators
        WHERE series_id = 'CPIAUCSL'
        ORDER BY observation_date DESC
        LIMIT 13
      ` as { value: number | string | null; observation_date: string | Date }[];

      if (cpiRows.length >= 13) {
        const latest = Number(cpiRows[0].value);
        const prior = Number(cpiRows[12].value);
        if (prior > 0 && !isNaN(latest) && !isNaN(prior)) {
          cpiYoy = ((latest - prior) / prior) * 100;
        }
      }
    } catch {
      // CPI YoY computation failed — leave as null
    }

    // Compute GDP YoY change: compare latest quarterly value to 4 quarters prior
    let gdpYoy: number | null = null;
    try {
      const gdpRows = await sql`
        SELECT value, observation_date
        FROM fed_economic_indicators
        WHERE series_id = 'GDPC1'
        ORDER BY observation_date DESC
        LIMIT 5
      ` as { value: number | string | null; observation_date: string | Date }[];

      // GDPC1 is quarterly — index 0 is latest, index 4 is ~1 year ago
      if (gdpRows.length >= 5) {
        const latest = Number(gdpRows[0].value);
        const yearAgo = Number(gdpRows[4].value);
        if (yearAgo > 0 && !isNaN(latest) && !isNaN(yearAgo)) {
          gdpYoy = ((latest - yearAgo) / yearAgo) * 100;
        }
      }
    } catch {
      // GDP YoY computation failed — leave as null
    }

    return {
      fed_funds_rate: byId.get("FEDFUNDS")?.value ?? null,
      unemployment_rate: byId.get("UNRATE")?.value ?? null,
      cpi_yoy_pct: cpiYoy,
      consumer_sentiment: byId.get("UMCSENT")?.value ?? null,
      gdp_growth_yoy_pct: gdpYoy !== null ? Math.round(gdpYoy * 10) / 10 : null,
      personal_savings_rate: byId.get("PSAVERT")?.value ?? null,
      bank_lending_standards: byId.get("DRCBLACBS")?.value ?? null,
      as_of,
    };
  } catch {
    return empty;
  }
}
