/**
 * Hamilton Citation Density Gate
 *
 * Refuses to render reports that make too many quantified claims without citing
 * their source. Published fee records are the backbone of
 * Hamilton's authority — an uncited report violates the "All data in reports
 * must trace to pipeline-verified fees" constraint in CLAUDE.md.
 *
 * Strategy: post-generation parse. Count sentences that state numeric or
 * comparative claims, count sentences that cite an identifiable source, and
 * refuse when the ratio or absolute count falls below thresholds.
 *
 * This is a surgical first pass (option a in the design brief). A future
 * iteration may move Hamilton to structured JSON output (option b) for
 * deterministic citation extraction — this module's public API is stable
 * enough to survive that migration.
 */

// ─── Configuration ────────────────────────────────────────────────────────────

/** Minimum ratio of citations to claims. Half of all claims must cite. */
const DEFAULT_DENSITY_MIN = 0.5;
/** Minimum absolute citation count, regardless of ratio. */
const DEFAULT_COUNT_MIN = 5;

function readEnvFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Module-load-time thresholds. Exported for visibility in tests and logs.
 * Env overrides: HAMILTON_CITATION_DENSITY_MIN, HAMILTON_CITATION_COUNT_MIN.
 */
export const CITATION_GATE_DEFAULTS = {
  densityMin: readEnvFloat("HAMILTON_CITATION_DENSITY_MIN", DEFAULT_DENSITY_MIN),
  countMin: readEnvInt("HAMILTON_CITATION_COUNT_MIN", DEFAULT_COUNT_MIN),
} as const;

// ─── Heuristics ───────────────────────────────────────────────────────────────

/**
 * A claim is a sentence containing at least one quantitative or comparative
 * assertion. We detect:
 *   - currency tokens ($123, $1,234.56)
 *   - percentages (23%, 23.4%)
 *   - bare numerics with magnitude context (integers >= 2 or decimals)
 *   - comparative words (higher, lower, more, less, above, below, exceeds)
 *   - superlative words (highest, lowest, largest, smallest, top, bottom)
 *   - ranking phrases (Nth percentile, median, average)
 *
 * A single sentence counts as one claim regardless of how many numerics it
 * contains — this matches reader intuition and keeps the ratio interpretable.
 */
const CURRENCY_RE = /\$[\d,]+(?:\.\d+)?/;
const PERCENT_RE = /\d+(?:\.\d+)?\s*%/;
const DECIMAL_RE = /\b\d+\.\d+\b/;
const LARGE_INT_RE = /\b\d{2,}(?:,\d{3})*\b/;
const COMPARATIVE_RE =
  /\b(higher|lower|more|less|above|below|exceeds?|outpaces?|trails?|greater|smaller|larger|up|down|rose|fell|grew|declin(?:ed|ing)|increas(?:ed|ing)|decreas(?:ed|ing))\b/i;
const SUPERLATIVE_RE =
  /\b(highest|lowest|largest|smallest|top|bottom|most|least|leading|trailing)\b/i;
const RANKING_RE =
  /\b(percentile|median|average|mean|p25|p50|p75|quartile|rank(?:ed|ing)?)\b/i;

/**
 * A citation is an explicit hook back to the pipeline or an authoritative
 * source. We detect, in priority order:
 *   - Markdown footnotes: [^1], [^id]
 *   - Bracketed source tags: [published_fee_records:abc123], [source: call_reports]
 *   - Inline source references: "per published fee records", "via Call Report",
 *     "from Beige Book", "FRED series X"
 *   - Named institution anchors: specific bank/CU names followed by a figure
 *     (e.g. "JPMorgan charges $35") — weak signal, requires a numeric
 *     nearby
 *   - Data-source mentions: "pipeline", "published fee records", "Call Report",
 *     "Beige Book", "FRED", "CFPB complaints"
 *
 * A sentence is "cited" if any of the above signals are present.
 */
const FOOTNOTE_RE = /\[\^[^\]]+\]/;
const BRACKETED_SOURCE_RE =
  /\[(?:source|src|published_fee_records|call_report|beige_book|fred|cfpb)[:\s][^\]]+\]/i;
const SOURCE_PHRASE_RE =
  /\b(?:per|via|from|according to|source:|cited in|reported by)\s+(?:the\s+)?(?:published fee records|published_fee_records|call report|beige book|fred|bls|bea|bureau of labor statistics|bureau of economic analysis|cfpb|pipeline|bank fee index|bfi)/i;
const DATA_SOURCE_MENTION_RE =
  /\b(published fee records|published_fee_records|call reports?|beige book|fred(?:\s+series)?|cfpb\s+complaints?|h\.8\s+release|ncua\s+5300|ffiec\s+\d{3})\b/i;
const INSTITUTION_ANCHOR_RE =
  /\b(?:[A-Z][a-zA-Z&.'-]+(?:\s+[A-Z][a-zA-Z&.'-]+){0,4})\s+(?:Bank|Credit Union|Federal Credit Union|FCU|N\.A\.|Savings|Financial|Trust|Corp|Inc)\b/;
/**
 * Secondary institution pattern: a multi-word proper noun (Hamilton typically
 * uses full names like "JPMorgan Chase", "Bank of America", "Fifth Third")
 * followed by a reporting verb that introduces an attributable figure.
 * Deliberately restrictive on verb choice to avoid catching narrative prose.
 */
const INSTITUTION_VERB_RE =
  /\b[A-Z][a-zA-Z&.'-]+(?:\s+(?:of\s+)?[A-Z][a-zA-Z&.'-]+){1,4}\s+(?:charges?|reports?|shows?|maintains?|holds?|levies|posts?|publishes|discloses?|charges?|sits?|lists?|sets?)\b/;

// ─── Sentence splitting ───────────────────────────────────────────────────────

/**
 * Split markdown into sentences, skipping structural elements that should be
 * exempt (headings, tables, code fences, bullet-only rows without prose).
 *
 * The intro/conclusion exemption in the design brief is handled by tagging
 * sentences inside paragraphs whose heading begins with "Introduction",
 * "Summary", "Conclusion", or the first paragraph of the document.
 */
interface Sentence {
  text: string;
  /** True if inside an intro/summary/conclusion section or document lede. */
  isExempt: boolean;
}

const EXEMPT_HEADING_RE = /^\s*#{1,6}\s*(introduction|intro|summary|conclusion|methodology|about this report|preface)\b/i;

export function splitIntoSentences(markdown: string): Sentence[] {
  // Strip code fences — never count their contents.
  const noCode = markdown.replace(/```[\s\S]*?```/g, "");

  const lines = noCode.split(/\r?\n/);
  const sentences: Sentence[] = [];
  let inExemptSection = false;
  let seenFirstHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Heading boundary: flip exempt flag
    if (/^#{1,6}\s/.test(line)) {
      inExemptSection = EXEMPT_HEADING_RE.test(line);
      seenFirstHeading = true;
      continue;
    }

    // Skip table rows, horizontal rules, and bullet markers without prose
    if (/^\|.*\|$/.test(line)) continue;
    if (/^[-*_]{3,}$/.test(line)) continue;

    // Strip list markers and blockquote prefixes but keep the prose
    const prose = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/^>\s*/, "");
    if (!prose) continue;

    // Naive sentence split — keep it simple and predictable. Splits on
    // sentence-terminal punctuation followed by whitespace + capital letter
    // or end-of-line. Preserves the terminator with the sentence.
    const parts = prose.split(/(?<=[.!?])\s+(?=[A-Z("'])/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length < 4) continue;
      // Document lede: first paragraph before any heading is treated as intro
      const isLede = !seenFirstHeading && sentences.length < 3;
      sentences.push({ text: trimmed, isExempt: inExemptSection || isLede });
    }
  }

  return sentences;
}

// ─── Claim / citation detection ───────────────────────────────────────────────

export function isClaim(sentence: string): boolean {
  if (CURRENCY_RE.test(sentence)) return true;
  if (PERCENT_RE.test(sentence)) return true;
  if (DECIMAL_RE.test(sentence)) return true;
  if (LARGE_INT_RE.test(sentence)) return true;
  // Bare comparatives/superlatives count only when paired with a numeric or
  // ranking signal — otherwise qualitative prose (e.g. "the market is
  // shifting toward lower friction") would false-positive.
  const hasNumericOrRanking =
    /\b\d+\b/.test(sentence) || RANKING_RE.test(sentence);
  if (hasNumericOrRanking && (COMPARATIVE_RE.test(sentence) || SUPERLATIVE_RE.test(sentence))) {
    return true;
  }
  return false;
}

export function isCitation(sentence: string): boolean {
  if (FOOTNOTE_RE.test(sentence)) return true;
  if (BRACKETED_SOURCE_RE.test(sentence)) return true;
  if (SOURCE_PHRASE_RE.test(sentence)) return true;
  if (DATA_SOURCE_MENTION_RE.test(sentence)) return true;
  // Named institution with a numeric nearby counts as an anchor — Hamilton's
  // typical "Bank of America charges $35" or "Fifth Third Bank reports..." pattern.
  const hasFigure = /\$|\d+%|\d+\.\d+/.test(sentence);
  if (hasFigure && (INSTITUTION_ANCHOR_RE.test(sentence) || INSTITUTION_VERB_RE.test(sentence))) {
    return true;
  }
  return false;
}

export function countClaims(markdown: string): number {
  return splitIntoSentences(markdown).filter((s) => !s.isExempt && isClaim(s.text)).length;
}

export function countCitations(markdown: string): number {
  return splitIntoSentences(markdown).filter((s) => !s.isExempt && isCitation(s.text)).length;
}

// ─── Gate evaluation ──────────────────────────────────────────────────────────

export interface CitationGateOptions {
  densityMin?: number;
  countMin?: number;
  /** Maximum uncited-claim examples to echo back to the caller. */
  maxExamples?: number;
}

export interface CitationGateMetrics {
  claims: number;
  citations: number;
  density: number;
  threshold: number;
  countThreshold: number;
}

export type CitationGateResult =
  | {
      status: "pass";
      metrics: CitationGateMetrics;
    }
  | {
      status: "refused";
      reason: "insufficient_citations";
      metrics: CitationGateMetrics;
      suggestion: string;
      claims_without_citations: string[];
    };

function buildSuggestion(metrics: CitationGateMetrics): string {
  const { claims, citations, threshold, countThreshold } = metrics;
  if (claims === 0) {
    return "This report contains no quantified claims. Hamilton refuses to render content without evidence. Narrow to a specific fee category or institution with published data.";
  }
  if (citations < countThreshold) {
    return `This report has ${claims} quantified claim${claims === 1 ? "" : "s"} but only ${citations} cite${citations === 1 ? "s" : ""} a specific data source (pipeline-verified fees, Call Reports, Beige Book, BLS, BEA or the Fed Board). The minimum is ${countThreshold} citations per report. Try narrowing to a specific fee category or institution tier with denser coverage.`;
  }
  return `This report has ${claims} quantified claim${claims === 1 ? "" : "s"} but only ${citations} cite a specific data source — a density of ${metrics.density.toFixed(2)} against the required ${threshold.toFixed(2)}. At least half of quantified claims must trace back to pipeline data. Narrow the scope or cite more specific institutions.`;
}

export function evaluateCitationDensity(
  markdown: string,
  options: CitationGateOptions = {},
): CitationGateResult {
  const densityMin = options.densityMin ?? CITATION_GATE_DEFAULTS.densityMin;
  const countMin = options.countMin ?? CITATION_GATE_DEFAULTS.countMin;
  const maxExamples = options.maxExamples ?? 5;

  const sentences = splitIntoSentences(markdown);
  const nonExempt = sentences.filter((s) => !s.isExempt);

  const claimSentences = nonExempt.filter((s) => isClaim(s.text));
  const citationSentences = nonExempt.filter((s) => isCitation(s.text));

  const claims = claimSentences.length;
  const citations = citationSentences.length;
  // When claims === 0 we report density: 0 rather than NaN. The caller's
  // refuse logic also guards on claims === 0 (see meetsDensity below), so
  // the zero here is a reporting choice, not a correctness short-circuit —
  // the response shape stays numeric and serializable.
  const density = claims === 0 ? 0 : citations / claims;

  const metrics: CitationGateMetrics = {
    claims,
    citations,
    density,
    threshold: densityMin,
    countThreshold: countMin,
  };

  const meetsDensity = claims === 0 ? false : density >= densityMin;
  const meetsCount = citations >= countMin;

  if (meetsDensity && meetsCount) {
    return { status: "pass", metrics };
  }

  const uncitedClaims = claimSentences
    .filter((s) => !isCitation(s.text))
    .slice(0, maxExamples)
    .map((s) => s.text);

  return {
    status: "refused",
    reason: "insufficient_citations",
    metrics,
    suggestion: buildSuggestion(metrics),
    claims_without_citations: uncitedClaims,
  };
}
