/**
 * The saved Hamilton answer the homepage shows in "Investigate a difference": a real answer
 * Hamilton gave for the sample institution, read from `hamilton_saved_analyses` and cropped
 * to its useful parts. Nothing here is written for the page; every sentence and figure is the
 * answer's own, and a field the answer lacks is left out rather than filled in.
 */

/**
 * Capital City Bank's overdraft answer (Oct 16, 2026): the fee the sample report marks, with
 * named competitors, the overdraft rules that apply and what the filings leave out. Swap the
 * id here (or set HAMILTON_SHOWCASE_ANSWER_ID) to show a different saved answer; one for an
 * institution other than the live sample report's is not shown.
 */
export const HAMILTON_SHOWCASE_ANSWER_ID = "5dbb59cf-64f7-45df-a679-9dc17182460a";

export function showcaseAnswerId(raw = process.env.HAMILTON_SHOWCASE_ANSWER_ID): string {
  return raw && /^[0-9a-f-]{36}$/i.test(raw.trim()) ? raw.trim() : HAMILTON_SHOWCASE_ANSWER_ID;
}

export interface ShowcaseSourced {
  text: string;
  source: string | null;
  url: string | null;
}

export interface ShowcaseAnswer {
  institutionId: number;
  institutionName: string;
  question: string;
  /** ISO date the answer was saved. */
  askedOn: string;
  /** The peer group Hamilton compared against, in Hamilton's words. */
  peerGroup: string | null;
  view: string;
  /** The fee the answer is about, by its report line key, when the answer names one. */
  feeKey: string | null;
  feeTitle: string | null;
  own: number | null;
  /** Medians the answer set the fee against, each with its count. */
  benchmarks: { label: string; value: number; n: number | null }[];
  findings: string[];
  competitors: { name: string; amount: number; url: string | null }[];
  competitorNote: string | null;
  /** Rules and regulation the answer cites, each with its source. */
  policy: ShowcaseSourced[];
  limitations: string[];
  questions: string[];
  sources: string[];
}

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "Fees on each institution's own published schedule (verified, live)" without its status note. */
function sourceLabel(label: string | null): string | null {
  return label ? label.replace(/\s*\((?:verified|live)[^)]*\)\s*$/i, "").trim() : null;
}

/** Fee keys the answer's exhibit titles name, matched to the report's line keys. */
const FEE_TITLES: [RegExp, string][] = [
  [/\boverdraft\b/i, "overdraft"],
  [/\bnsf\b|insufficient/i, "nsf"],
  [/non-network atm/i, "atm_non_network"],
  [/monthly (maintenance|service)/i, "monthly_maintenance"],
  [/stop payment/i, "stop_payment"],
];

/** Sentences in Hamilton's memo that say what the evidence does not show. */
const LIMITATION = /\b(do not|does not|did not|not report|cannot yet|still building|is missing|are missing)\b/i;

function sentences(text: string | null): string[] {
  return text ? text.split(/(?<=[.?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean) : [];
}

export function parseShowcaseAnswer(
  row: { institution_id: string; prompt: string | null; created_at: string; response_json: unknown } | null,
): ShowcaseAnswer | null {
  const r = obj(row?.response_json);
  if (!row || !r) return null;
  const story = obj(r.storyline);
  const memo = obj(r.memo);
  const identity = obj(r.identityContext) ?? obj(memo?.identityContext);
  const institutionId = Number(row.institution_id);
  const institutionName = str(identity?.researchInstitutionName);
  const question = str(row.prompt);
  const view = str(r.hamiltonView) ?? str(memo?.summary);
  if (!Number.isInteger(institutionId) || !institutionName || !question || !view) return null;

  const exhibits = arr(story?.exhibits).map((e) => obj(obj(e)?.exhibit)).filter((e): e is Json => e !== null);
  const position = exhibits.find((e) => e.kind === "fee_position") ?? null;
  const range = exhibits.find((e) => e.kind === "competitor_range") ?? null;
  const feeTitle = str(position?.title) ?? str(range?.title);
  const feeKey = feeTitle ? (FEE_TITLES.find(([re]) => re.test(feeTitle))?.[1] ?? null) : null;

  const benchmarks = arr(position?.markers)
    .map((m) => obj(m))
    .flatMap((m) => {
      const label = str(m?.label);
      const value = num(m?.value);
      return label && value !== null ? [{ label: label.replace(/^Local market \([^)]*\) median$/, "Local median").replace(/ \([^)]*\) median$/, " median"), value, n: num(m?.n) }] : [];
    });

  const competitors = arr(range?.items)
    .map((i) => obj(i))
    .flatMap((i) => {
      const name = str(i?.name);
      const amount = num(i?.amount);
      return name && amount !== null ? [{ name, amount, url: str(i?.url) }] : [];
    });

  const lenses = obj(story?.lenses);
  const lensItems = [...arr(lenses?.market), ...arr(lenses?.finance)].map((l) => obj(l)).filter((l): l is Json => l !== null);
  // A rule or regulation is cited with its own reference, not read from a data table.
  const policy = lensItems
    .filter((l) => {
      const source = obj(l.source);
      return source && !str(source.table) && /cfpb|reg\b|regulation|cfr|circular|rule/i.test(str(source.label) ?? "");
    })
    .flatMap((l) => {
      const text = str(l.text);
      const source = obj(l.source);
      return text ? [{ text, source: str(source?.label), url: str(source?.url) }] : [];
    });

  const limitations = [...new Set([view, str(memo?.board), str(memo?.market)].flatMap(sentences).filter((s) => LIMITATION.test(s)))].slice(0, 3);

  const sourceLabels = [
    ...arr(story?.situation),
    ...lensItems,
    ...arr(story?.keyFigures),
    ...exhibits.flatMap((e) => arr(e.sources).map((s) => ({ source: s }))),
  ]
    .map((x) => sourceLabel(str(obj(obj(x)?.source)?.label)))
    .filter((s): s is string => s !== null);

  return {
    institutionId,
    institutionName,
    question,
    askedOn: row.created_at.slice(0, 10),
    peerGroup: str(identity?.peerBaselineLabel),
    view,
    feeKey,
    feeTitle,
    own: num(position?.own),
    benchmarks,
    findings: arr(r.whyItMatters).map(str).filter((s): s is string => s !== null),
    competitors,
    competitorNote: str(range?.note),
    policy,
    limitations,
    questions: arr(r.exploreFurther ?? memo?.questions).map(str).filter((s): s is string => s !== null),
    // "Fees on each institution's own published schedule" repeats the Index's own source line.
    sources: [...new Set(sourceLabels)].filter((s, _, all) => !(/own published schedule/i.test(s) && all.some((o) => /published fee schedules/i.test(o)))),
  };
}
