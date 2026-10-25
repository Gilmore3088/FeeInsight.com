import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O2, the optional retrieval shadow pilot (V5 build plan, Truth lane; PRD V5 section 10).
 *
 * Question: does a metadata + full-text ranker put a bank's current fee schedule nearer the top
 * of its stored candidate pages than the way the pipeline picks that page today? It is measured
 * on frozen inputs only, read-only, with no provider call and no new vendor, and nothing in the
 * live pipeline imports this file (`retrieval-pilot.test.ts` checks that).
 *
 * Policy (PRD V5 section 10): a retrieval add-on may only re-order candidate pages that are
 * already approved sources. It is never the source of truth, never proof that a fee is absent,
 * never a currency check and never permission to publish. Metadata and full-text search come
 * first; embeddings are considered only on measured holdout lift.
 *
 * Two rankers over the same candidates:
 * - `baselineRanking`, today's selection: the copy at the bank's fee link
 *   (`institution_sources.fee_schedule_url`) first, then the profile's remembered address, then
 *   the bank's other non-rejected sources (companion pages), then every other stored page. These
 *   are the pages Hamilton's current-copy check treats as the bank's sources
 *   (`hamilton/current-copy.ts`, `retiredCopiesSql`); within a tier the newest document goes
 *   first, as the newest copy at a link is the current one (`magellan/current-copy.ts`).
 * - `metadataRanking`: the document's own signals only, never the pipeline's link. A BM25 score
 *   over core fee terms, Rosetta's document kind, address cues, opening-text cues and the
 *   schedule's own date (`source_documents.stated_date`, Magellan #2615, else the latest year in
 *   its opening text, else in its address). Its weights are tuned on the tuning split only
 *   (`tuneWeights`); the holdout is scored once with the committed `TUNED_WEIGHTS`.
 *
 * Labels are pages a human or browser check confirmed against the bank's current schedule (see
 * the fixture's `about`). Nothing here is filled in: a labelled page with no stored copy is a
 * false negative for both rankers, counted as `notStored`.
 */

export const RETRIEVAL_PILOT_FIXTURE = "src/lib/agents/deming/__fixtures__/retrieval-pilot-2026-10-25.json";
/** The labels date from Oct 18-19, 2026; a date after this year is a schedule not yet in effect. */
export const AS_OF_YEAR = 2026;
export const TOP_K = [1, 3, 10] as const;

export type Split = "tuning" | "holdout";

export interface RetrievalCandidate {
  document_id: number;
  url: string;
  crawled_on: string | null;
  copies: number;
  stated_date: string | null;
  stated_date_basis: string | null;
  head_year: number | null;
  content_type: string | null;
  fee_link: boolean;
  profile_link: boolean;
  extra_source_status: string | null;
  extra_source_role: string | null;
  text_chars: number;
  document_kind: string | null;
  text_type: string | null;
  term_counts: number[] | null;
  head_schedule_cues: number;
  head_off_topic_cues: number;
  dollar_figures: number;
}

export interface RetrievalInstitution {
  institution_id: number;
  split: Split;
  label_sources: string[];
  relevant_urls: string[];
  primary_url: string;
  stale_or_wrong_urls: string[];
  candidates: RetrievalCandidate[];
}

export interface RetrievalFixture {
  about: { terms: string[]; institutions: number; pages: number } & Record<string, unknown>;
  institutions: RetrievalInstitution[];
}

export function readRetrievalFixture(root: string = process.cwd()): RetrievalFixture {
  return JSON.parse(readFileSync(join(root, RETRIEVAL_PILOT_FIXTURE), "utf8")) as RetrievalFixture;
}

/** The split is fixed by the institution id alone, so nobody can move a bank between splits. */
export function splitFor(institutionId: number): Split {
  return createHash("sha256").update(`o2-retrieval-pilot:${institutionId}`).digest()[0] % 2 === 0 ? "holdout" : "tuning";
}

/** Query parameters that change how a page is printed, tracked or cached (sfvrsn, cm_sp), never which page it is. */
const PRESENTATION_PARAM = /^(?:print|output|utm_[a-z]+|icid|gclid|fbclid|sfvrsn|cm_sp)$/;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * One page under its several spellings, for labels and candidates alike: no scheme, "www.",
 * fragment, case or trailing slash; percent-escapes and "&amp;" decoded; print and tracking
 * parameters dropped ("/fees?print=1&output=amp" is the confirmed "/fees" page, printed).
 */
export function pageKey(url: string): string {
  const [rawPath, rawQuery = ""] = decode(url.trim().split("#")[0].replace(/&amp;/g, "&"))
    .replace(/^https?:\/\/(www\.)?/i, "")
    .toLowerCase()
    .split(/\?(.*)/s);
  const query = rawQuery
    .split("&")
    .filter((pair) => pair !== "" && !PRESENTATION_PARAM.test(pair.split("=")[0]))
    .join("&");
  const path = rawPath.replace(/\/+$/, "");
  return query ? `${path}?${query}` : path;
}

/** A ranking as distinct pages, first spelling first. */
function rankedPages(ranked: readonly RetrievalCandidate[]): string[] {
  return [...new Set(ranked.map((c) => pageKey(c.url)))];
}

const byNewest = (a: RetrievalCandidate, b: RetrievalCandidate) => b.document_id - a.document_id;

function baselineTier(c: RetrievalCandidate): number {
  if (c.fee_link) return 0;
  if (c.profile_link) return 1;
  if (c.extra_source_status != null && c.extra_source_status !== "rejected") return 2;
  return 3;
}

/** Today's selection, reconstructed (see the module note). */
export function baselineRanking(candidates: readonly RetrievalCandidate[]): RetrievalCandidate[] {
  return [...candidates].sort((a, b) => baselineTier(a) - baselineTier(b) || byNewest(a, b));
}

export interface RankerWeights {
  bm25: number;
  kind: number;
  url: number;
  head: number;
  date: number;
}

/**
 * Tuned on the tuning split by `tuneWeights` (grid `WEIGHT_GRID`); the test re-runs the tuning
 * and fails if these differ, so they can only come from the tuning split.
 */
export const TUNED_WEIGHTS: RankerWeights = { bm25: 0.5, kind: 2, url: 0, head: 0.5, date: 2 };
export const WEIGHT_GRID: readonly number[] = [0, 0.5, 1, 2];

const BM25_K1 = 1.2;
const BM25_B = 0.75;

const KIND_SCORE: Record<string, number> = {
  fee_schedule: 1,
  truth_in_savings: 0.5,
  product_page: 0,
  account_agreement: -0.5,
  other: -0.5,
};
const NO_TEXT_KIND_SCORE = -1;

const URL_SCHEDULE = /fee|schedule|charge|pricing/;
const URL_OFF_TOPIC = /agreement|terms|privacy|loan|mortgage|payroll|spanish|espanol|career|news|blog|rates?(?:[-_/.]|$)/;
const HEAD_CUE_CAP = 3;
const URL_YEAR = /(?:^|[^0-9])(20[0-2][0-9])(?:[^0-9]|$)/g;

/** Corpus statistics for BM25: document frequency per term and the mean text length. Uses no labels. */
export interface Bm25Corpus {
  docs: number;
  df: number[];
  meanChars: number;
}

export function bm25Corpus(institutions: readonly RetrievalInstitution[], terms: number): Bm25Corpus {
  const df = new Array<number>(terms).fill(0);
  let docs = 0;
  let chars = 0;
  for (const inst of institutions) {
    for (const c of inst.candidates) {
      if (!c.term_counts) continue;
      docs += 1;
      chars += c.text_chars;
      c.term_counts.forEach((count, i) => {
        if (count > 0) df[i] += 1;
      });
    }
  }
  return { docs, df, meanChars: docs === 0 ? 1 : chars / docs };
}

export function bm25(c: RetrievalCandidate, corpus: Bm25Corpus): number {
  if (!c.term_counts) return 0;
  const norm = 1 - BM25_B + BM25_B * (Math.max(c.text_chars, 1) / corpus.meanChars);
  return c.term_counts.reduce((sum, tf, i) => {
    if (tf <= 0) return sum;
    const df = corpus.df[i] ?? 0;
    const idf = Math.log(1 + (corpus.docs - df + 0.5) / (df + 0.5));
    return sum + (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm);
  }, 0);
}

/** The schedule's own year: its stated date, else the latest year in its opening text, else in its address. */
export function documentYear(c: RetrievalCandidate): number | null {
  if (c.stated_date) return Number(c.stated_date.slice(0, 4));
  if (c.head_year != null) return c.head_year;
  const years = [...pageKey(c.url).matchAll(URL_YEAR)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : null;
}

function dateScore(year: number | null): number {
  if (year == null || year > AS_OF_YEAR) return 0;
  if (year === AS_OF_YEAR) return 1;
  if (year === AS_OF_YEAR - 1) return 0.5;
  if (year === AS_OF_YEAR - 2) return 0;
  return -1;
}

function urlScore(page: string): number {
  const path = page.slice(page.indexOf("/") + 1);
  return (URL_SCHEDULE.test(path) ? 1 : 0) - (URL_OFF_TOPIC.test(path) ? 1 : 0);
}

function headScore(c: RetrievalCandidate): number {
  return Math.min(c.head_schedule_cues, HEAD_CUE_CAP) / HEAD_CUE_CAP - Math.min(c.head_off_topic_cues, HEAD_CUE_CAP) / HEAD_CUE_CAP;
}

/** The metadata + full-text ranker. BM25 is scaled to the institution's best candidate (0..1). */
export function metadataRanking(candidates: readonly RetrievalCandidate[], corpus: Bm25Corpus, weights: RankerWeights = TUNED_WEIGHTS): RetrievalCandidate[] {
  const text = candidates.map((c) => bm25(c, corpus));
  const best = Math.max(0, ...text);
  const scored = candidates.map((c, i) => ({
    c,
    score:
      weights.bm25 * (best > 0 ? text[i] / best : 0) +
      weights.kind * (c.term_counts ? (KIND_SCORE[c.document_kind ?? ""] ?? 0) : NO_TEXT_KIND_SCORE) +
      weights.url * urlScore(pageKey(c.url)) +
      weights.head * headScore(c) +
      weights.date * dateScore(documentYear(c)),
  }));
  return scored.sort((a, b) => b.score - a.score || byNewest(a.c, b.c)).map((s) => s.c);
}

export interface SplitMetrics {
  institutions: number;
  relevantPages: number;
  relevantPagesStored: number;
  /** Relevant pages ranked in the top k, over every relevant page (stored or not). */
  recallAt3: number;
  recallAt10: number;
  /** Institutions whose first-ranked page is relevant, over institutions. */
  precisionAt1: number;
  /** Institutions whose first-ranked page is the one with the most confirmed fees. */
  primaryAt1: number;
  /** Institutions whose first-ranked page a check called stale or the wrong document. */
  staleOrWrongAt1: number;
  /** Primary page not in the top 3: never stored (no ranker can fix it) or ranked lower. */
  falseNegativesAt3: { notStored: number[]; rankedLower: number[] };
  falseNegativesAt10: { notStored: number[]; rankedLower: number[] };
}

export type Ranker = (inst: RetrievalInstitution) => RetrievalCandidate[];

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

export function scoreSplit(institutions: readonly RetrievalInstitution[], rank: Ranker): SplitMetrics & { hits: Record<number, boolean> } {
  let relevantPages = 0;
  let relevantPagesStored = 0;
  let at3 = 0;
  let at10 = 0;
  let p1 = 0;
  let primary1 = 0;
  let stale1 = 0;
  const fn3 = { notStored: [] as number[], rankedLower: [] as number[] };
  const fn10 = { notStored: [] as number[], rankedLower: [] as number[] };
  const hits: Record<number, boolean> = {};
  for (const inst of institutions) {
    const ranked = rankedPages(rank(inst));
    const relevant = new Set(inst.relevant_urls.map(pageKey));
    const staleOrWrong = new Set(inst.stale_or_wrong_urls.map(pageKey));
    const primary = pageKey(inst.primary_url);
    const stored = new Set(inst.candidates.map((c) => pageKey(c.url)));
    relevantPages += relevant.size;
    relevantPagesStored += [...relevant].filter((u) => stored.has(u)).length;
    at3 += ranked.slice(0, 3).filter((u) => relevant.has(u)).length;
    at10 += ranked.slice(0, 10).filter((u) => relevant.has(u)).length;
    const top = ranked[0];
    hits[inst.institution_id] = top != null && relevant.has(top);
    if (hits[inst.institution_id]) p1 += 1;
    if (top === primary) primary1 += 1;
    if (top != null && staleOrWrong.has(top)) stale1 += 1;
    const position = ranked.indexOf(primary);
    for (const [k, fn] of [[3, fn3], [10, fn10]] as const) {
      if (position >= 0 && position < k) continue;
      (position < 0 ? fn.notStored : fn.rankedLower).push(inst.institution_id);
    }
  }
  return {
    institutions: institutions.length,
    relevantPages,
    relevantPagesStored,
    recallAt3: ratio(at3, relevantPages),
    recallAt10: ratio(at10, relevantPages),
    precisionAt1: ratio(p1, institutions.length),
    primaryAt1: ratio(primary1, institutions.length),
    staleOrWrongAt1: stale1,
    falseNegativesAt3: fn3,
    falseNegativesAt10: fn10,
    hits,
  };
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Grid search on the tuning split: best recall@3, then precision@1, then recall@10; first in grid order wins ties. */
export function tuneWeights(tuning: readonly RetrievalInstitution[], corpus: Bm25Corpus): RankerWeights {
  if (tuning.some((inst) => inst.split !== "tuning")) throw new Error("retrieval pilot: weights are tuned on the tuning split only");
  let best: { weights: RankerWeights; key: number[] } | null = null;
  for (const bm of WEIGHT_GRID)
    for (const kind of WEIGHT_GRID)
      for (const url of WEIGHT_GRID)
        for (const head of WEIGHT_GRID)
          for (const date of WEIGHT_GRID) {
            if (bm + kind + url + head + date === 0) continue;
            const weights = { bm25: bm, kind, url, head, date };
            const m = scoreSplit(tuning, (inst) => metadataRanking(inst.candidates, corpus, weights));
            const key = [m.recallAt3, m.precisionAt1, m.recallAt10];
            if (best == null || compareKeys(key, best.key) > 0) best = { weights, key };
          }
  return (best as { weights: RankerWeights }).weights;
}

/** Exact two-sided sign test on paired wins and losses (ties dropped). */
export function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  let coef = 1;
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) coef = (coef * (n - i + 1)) / i;
    tail += coef;
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/** Below this many decided pairs not even a clean sweep reaches p < 0.05. */
export const MIN_DECIDED_PAIRS = 6;

export type Verdict = "lift" | "loss" | "no_measurable_difference" | "too_few_labels";

export interface PilotResult {
  fixture: string;
  weights: RankerWeights;
  splits: Record<Split, { baseline: SplitMetrics; metadata: SplitMetrics; paired: { wins: number; losses: number; ties: number; p: number } }>;
  verdict: Verdict;
}

export function runRetrievalPilot(fixture: RetrievalFixture = readRetrievalFixture()): PilotResult {
  const corpus = bm25Corpus(fixture.institutions, fixture.about.terms.length);
  const splits = {} as PilotResult["splits"];
  for (const split of ["tuning", "holdout"] as const) {
    const insts = fixture.institutions.filter((i) => i.split === split);
    const { hits: baseHits, ...baseline } = scoreSplit(insts, (i) => baselineRanking(i.candidates));
    const { hits: metaHits, ...metadata } = scoreSplit(insts, (i) => metadataRanking(i.candidates, corpus, TUNED_WEIGHTS));
    let wins = 0;
    let losses = 0;
    for (const inst of insts) {
      if (metaHits[inst.institution_id] && !baseHits[inst.institution_id]) wins += 1;
      if (!metaHits[inst.institution_id] && baseHits[inst.institution_id]) losses += 1;
    }
    splits[split] = { baseline, metadata, paired: { wins, losses, ties: insts.length - wins - losses, p: signTestP(wins, losses) } };
  }
  const { wins, losses, p } = splits.holdout.paired;
  const verdict: Verdict = wins + losses < MIN_DECIDED_PAIRS ? "too_few_labels" : p >= 0.05 ? "no_measurable_difference" : wins > losses ? "lift" : "loss";
  return { fixture: RETRIEVAL_PILOT_FIXTURE, weights: TUNED_WEIGHTS, splits, verdict };
}

const pct = (v: number, whole: number) => `${(v * 100).toFixed(1)}% (${Math.round(v * whole)}/${whole})`;

export function renderRetrievalReport(result: PilotResult): string {
  const lines = [
    "# Retrieval shadow pilot (O2)",
    "",
    `Fixture: \`${result.fixture}\`. Weights (tuned on the tuning split only): ${JSON.stringify(result.weights)}.`,
    "",
    "| Split | Ranker | Institutions | recall@3 | recall@10 | precision@1 | primary@1 | stale/wrong@1 | FN@3 not stored | FN@3 ranked lower | FN@10 ranked lower |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const split of ["tuning", "holdout"] as const) {
    for (const ranker of ["baseline", "metadata"] as const) {
      const m = result.splits[split][ranker];
      lines.push(
        `| ${split} | ${ranker} | ${m.institutions} | ${pct(m.recallAt3, m.relevantPages)} | ${pct(m.recallAt10, m.relevantPages)} | ${pct(m.precisionAt1, m.institutions)} | ${pct(m.primaryAt1, m.institutions)} | ${m.staleOrWrongAt1} | ${m.falseNegativesAt3.notStored.length} | ${m.falseNegativesAt3.rankedLower.length} | ${m.falseNegativesAt10.rankedLower.length} |`,
      );
    }
  }
  const h = result.splits.holdout.paired;
  lines.push("", `Holdout precision@1, metadata against baseline: ${h.wins} wins, ${h.losses} losses, ${h.ties} ties; sign test p = ${h.p.toFixed(3)}.`, `Verdict: ${result.verdict}.`, "");
  return lines.join("\n");
}
