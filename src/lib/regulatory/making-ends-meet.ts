import { strFromU8, unzipSync } from "fflate";
import { findListLinks, readTableRows } from "./designation-lists";
import { publishedNumber, seriesSlug, stateCodeFromName, type AreaFetch, type AreaStat } from "./economy";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { CsvStreamParser, parseCsvTable } from "./industry-events";

/**
 * CFPB Making Ends Meet survey, public-use file. Pure transport and parsing: no DB access.
 *
 * The survey (waves from 2019) asks households about bills, savings, fees and credit use, and is
 * linked to their credit records. The public-use file is a respondent-level data file plus a
 * codebook. This module downloads both, finds each question BY THE CODEBOOK'S WORDING (never by a
 * remembered variable name), and computes weighted national shares per wave with the survey
 * weight the codebook names, plus breakouts by income band, Census region and state when the file
 * carries those, and overdraft payers versus non-payers on the financial-stress measures.
 *
 * The CFPB site was blocked from the sandbox this was written in, so the page and file URLs below
 * are remembered or guessed. The loader discovers file links from the CFPB data pages first, takes
 * env overrides (`MAKING_ENDS_MEET_DATA_URL`, `MAKING_ENDS_MEET_CODEBOOK_URL`) over both, and
 * reports which questions it found, per wave. It never guesses an answer code: an answer is read
 * through the codebook's value label (or the data's own text), and a measure whose answers include
 * a label it cannot place as yes/no is not computed at all; the labels are named in the report.
 */

export const MEM_PAGE_URLS = [
  "https://www.consumerfinance.gov/data-research/making-ends-meet-survey-data/public-data/",
  "https://www.consumerfinance.gov/data-research/making-ends-meet-survey-data/public-use-file/",
  "https://www.consumerfinance.gov/data-research/making-ends-meet-survey-data/",
] as const;
export const MEM_USER_GUIDE_URL = "https://files.consumerfinance.gov/f/documents/cfpb_making-ends-meet_public-use-file_user-guide.pdf";
/** Guessed from the user guide's file name; tried only when the pages list no file. */
export const MEM_GUESS_CODEBOOK_URLS = [
  "https://files.consumerfinance.gov/f/documents/cfpb_making-ends-meet_public-use-file_codebook.pdf",
  "https://files.consumerfinance.gov/f/documents/cfpb_making-ends-meet_public-use-file_codebook.xlsx",
] as const;
/**
 * One zip per sample (data CSV and DTA, questionnaires, codebook), as the public-data page listed
 * them on 2026-10-17. Sample 2 is not released. Used, all of them, when the pages list no file.
 */
export const MEM_KNOWN_DATA_URLS = [1, 3, 4, 5, 6].map(
  (sample) => `https://files.consumerfinance.gov/f/documents/cfpb_making-ends-meet_data-sample-${sample}.zip`,
);
export const MEM_DATA_URL_ENV = "MAKING_ENDS_MEET_DATA_URL";
export const MEM_CODEBOOK_URL_ENV = "MAKING_ENDS_MEET_CODEBOOK_URL";

/** Respondent counts under this get a "small sample" note; the value is still stored. */
export const MEM_SMALL_SAMPLE = 50;

// ---------------------------------------------------------------------------
// Codebook
// ---------------------------------------------------------------------------

export interface ValueLabel {
  code: string;
  label: string;
}

export interface CodebookEntry {
  variable: string;
  /** Question wording / variable label as the codebook gives it (normalised spaces). */
  text: string;
  labels: ValueLabel[];
}

export interface Codebook {
  format: "table" | "text";
  entries: CodebookEntry[];
}

function norm(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1", "1.0", "01" -> "1"; text lowercased. */
export function normCode(value: string): string {
  const raw = value.trim();
  if (/^-?\d+(\.0+)?$/.test(raw)) return String(Number(raw));
  return raw.toLowerCase();
}

const isNumeric = (value: string) => /^-?\d+(\.\d+)?$/.test(value.trim());

/**
 * Value labels from codebook text: "1 = Yes 2 = No" on one line, or one "1 Yes" / "1. Yes" /
 * "1) Yes" per line. Two or more trailing numbers (frequency and percent columns) are dropped.
 */
export function parseValueLabels(segment: string): ValueLabel[] {
  const out: ValueLabel[] = [];
  const seen = new Set<string>();
  const add = (code: string, label: string) => {
    const c = normCode(code);
    const l = norm(label.replace(/^[\s:.)=-]+/, ""));
    if (!l || seen.has(c)) return;
    seen.add(c);
    out.push({ code: c, label: l });
  };
  for (const line of segment.split(/\r?\n|;/)) {
    const eq = [...line.matchAll(/(-?\d+(?:\.\d+)?)\s*=\s*([^=]+?)(?=\s+-?\d+(?:\.\d+)?\s*=|,\s*-?\d+(?:\.\d+)?\s*=|$)/g)];
    if (eq.length > 0) {
      for (const m of eq) add(m[1], m[2].replace(/,\s*$/, ""));
      continue;
    }
    const m = /^\s*(-?\d{1,4}(?:\.\d+)?)\s*(?:[:.)-]\s*|\s+)([A-Za-z$<>"'(][^\n]*?)\s*$/.exec(line);
    if (!m) continue;
    let label = m[2];
    const trailing = /((?:\s+[\d,]+(?:\.\d+)?%?){2,})\s*$/.exec(label);
    if (trailing) label = label.slice(0, trailing.index);
    add(m[1], label);
  }
  return out;
}

const VAR_HEADER = /^(variable|variable name|var|var name|varname|variable_name|name|column|column name|field|field name)$/;
const TEXT_HEADER = /(question|wording|description|variable label|^label$|^text$|item text|item wording)/;
const CODE_HEADER = /^(value|values|code|codes|value code|response code|response value|answer code)$/;
const VALUE_LABEL_HEADER = /(value label|value description|response (label|option|text|category)|answer (label|option|text)|^category$|^response$|^responses$)/;

/**
 * A codebook laid out as a table (xlsx or csv): one variable per row or per run of rows, with a
 * variable-name column, a question/label column and, optionally, value code and value label
 * columns (long format) or one "1=Yes; 2=No" values cell. Null when no header row is found.
 */
export function parseTableCodebook(rows: string[][]): Codebook | null {
  for (let r = 0; r < Math.min(rows.length, 30); r += 1) {
    const cells = rows[r].map((c) => norm(c).toLowerCase());
    const varCol = cells.findIndex((c) => VAR_HEADER.test(c));
    const textCols = cells.map((c, i) => (TEXT_HEADER.test(c) && !/value|response|answer|code/.test(c) ? i : -1)).filter((i) => i >= 0 && i !== varCol);
    if (varCol < 0 || textCols.length === 0) continue;
    const codeCol = cells.findIndex((c) => CODE_HEADER.test(c));
    const valueLabelCol = cells.findIndex((c, i) => VALUE_LABEL_HEADER.test(c) && i !== codeCol && !textCols.includes(i));
    const byVar = new Map<string, CodebookEntry>();
    let current: CodebookEntry | null = null;
    for (const row of rows.slice(r + 1)) {
      const variable = (row[varCol] ?? "").trim();
      if (variable && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(variable)) {
        current = byVar.get(variable.toLowerCase()) ?? null;
        if (!current) {
          current = { variable, text: "", labels: [] };
          byVar.set(variable.toLowerCase(), current);
        }
        const text = norm(textCols.map((i) => row[i] ?? "").filter(Boolean).join(" "));
        if (text && !current.text.includes(text)) current.text = norm(`${current.text} ${text}`);
      } else if (variable) {
        current = null;
        continue;
      }
      if (!current) continue;
      const code = codeCol >= 0 ? (row[codeCol] ?? "").trim() : "";
      const label = valueLabelCol >= 0 ? (row[valueLabelCol] ?? "").trim() : "";
      if (code && label) {
        if (!current.labels.some((l) => l.code === normCode(code))) current.labels.push({ code: normCode(code), label: norm(label) });
      } else if (code && !label) {
        for (const l of parseValueLabels(code)) if (!current.labels.some((x) => x.code === l.code)) current.labels.push(l);
      } else if (!code && label) {
        for (const l of parseValueLabels(label)) if (!current.labels.some((x) => x.code === l.code)) current.labels.push(l);
      }
    }
    return { format: "table", entries: [...byVar.values()] };
  }
  return null;
}

/**
 * A codebook as running text (PDF or plain text). The data file's own column names are the
 * anchors: a variable's entry starts at the first line that begins with its name (optionally
 * after "Variable:"), and runs to the next anchor. The entry's text is its wording; value labels
 * are read from its lines. A column with no line-start mention gets no entry.
 */
export function parseTextCodebook(text: string, headers: string[]): Codebook {
  const lines = text.split(/\r?\n/);
  const wanted = new Map(headers.map((h) => [h.trim().toLowerCase(), h.trim()]));
  const anchors: Array<{ variable: string; line: number; rest: string }> = [];
  const used = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*(?:variable(?:\s+name)?\s*[:-]\s*)?([A-Za-z_][A-Za-z0-9_.]*)\b(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const variable = wanted.get(key);
    if (!variable || used.has(key)) continue;
    used.add(key);
    anchors.push({ variable, line: i, rest: m[2] });
  }
  const entries = anchors.map((a, idx) => {
    const end = idx + 1 < anchors.length ? anchors[idx + 1].line : lines.length;
    const body = [a.rest, ...lines.slice(a.line + 1, end)];
    const labels = parseValueLabels(body.join("\n"));
    const wording = body.filter((l) => !/^\s*-?\d{1,4}(?:\.\d+)?\s*(?:[:.)=-]|\s)/.test(l)).join(" ");
    return { variable: a.variable, text: norm(wording.replace(/^[\s:.-]+/, "")), labels };
  });
  return { format: "text", entries };
}

// ---------------------------------------------------------------------------
// Questions, matched by wording
// ---------------------------------------------------------------------------

type Verdict = "pos" | "neg" | null;

/** Answers that are not answers: excluded from every share, never counted as "no". */
export const MISSING_LABEL = /(refus|don'?t know|do not know|\bdk\b|not asked|skipp|missing|legitimate skip|valid skip|not applicable|\bn\/a\b|no answer|prefer not|not sure|unknown|not reported|suppressed)/;

function yesNo(label: string): Verdict {
  if (/^(yes|true|selected|checked)\b/.test(label)) return "pos";
  if (/^(no|false|not selected|unchecked)\b/.test(label)) return "neg";
  return null;
}

function yesOrCount(label: string): Verdict {
  const yn = yesNo(label);
  if (yn) return yn;
  if (/^(none|never|zero|0)\b/.test(label) || /^0 times/.test(label)) return "neg";
  if (/^([1-9]\d*|once|twice|one|two|three|four|five|more than|several|many)\b/.test(label)) return "pos";
  return null;
}

function difficulty(label: string): Verdict {
  const yn = yesNo(label);
  if (yn) return yn;
  if (/(neither|neutral)/.test(label)) return null;
  if (/(not (at all |very |too )?(difficult|hard)|no difficulty|^easy|^very easy|^somewhat easy)/.test(label)) return "neg";
  if (/(difficult|hard|struggl)/.test(label)) return "pos";
  return null;
}

function couldCover(label: string): Verdict {
  const yn = yesNo(label);
  if (yn) return yn;
  if (/(could not|couldn'?t|cannot|can'?t|unable|would not be able|wouldn'?t be able|not able)/.test(label)) return "neg";
  if (/^(i |we )?(certainly|probably|definitely)?\s*(could|can|would be able|able)\b/.test(label)) return "pos";
  return null;
}

/** Ignore matches on these: amounts, reasons and applications are different questions. */
const NOT_INCIDENCE = /(how much|amount|dollars? (did|was|were)|total cost|reason|why did|apply|applied|denied|turned down|rejected)/;
const TWELVE_MONTHS = /(12 months|twelve months|past year|last year|prior year)/;

export type MeasureKind = "binary" | "distribution";

export interface MeasureSpec {
  key: string;
  label: string;
  kind: MeasureKind;
  find: (text: string) => boolean;
  /** Tie-breakers, in order: candidates passing one are kept when any pass. */
  prefer: Array<(text: string) => boolean>;
  classify?: (label: string) => Verdict;
  /** Union of every matching variable (any yes), instead of requiring one variable. */
  union?: boolean;
  /** Also stored as a per-label distribution (the overdraft count bands). */
  distribution?: boolean;
  /** A financial-stress measure compared between overdraft payers and non-payers. */
  stress?: boolean;
}

const AFS = {
  payday: /payday/,
  pawn: /\bpawn/,
  title: /(auto|car|vehicle)[ -]?title/,
  other: /(check[ -]?cash|rent[ -]to[ -]own|refund anticipation|tax refund (advance|loan))/,
};
const afsProducts = (t: string) => (Object.keys(AFS) as Array<keyof typeof AFS>).filter((k) => AFS[k].test(t));

export const OVERDRAFT_KEY = "mem_paid_overdraft_fee";

export const MEM_MEASURES: MeasureSpec[] = [
  {
    key: OVERDRAFT_KEY,
    label: "Paid an overdraft or NSF fee",
    kind: "binary",
    find: (t) => /(overdraft|overdrawn|non-?sufficient funds|insufficient funds|\bnsf\b|bounced? (a )?check)/.test(t) && /(fee|charge)/.test(t) && !NOT_INCIDENCE.test(t) && !/(opt(ed)?[ -]?in|enrol|protection program)/.test(t),
    prefer: [(t) => TWELVE_MONTHS.test(t), (t) => /overdraft/.test(t)],
    classify: yesOrCount,
    distribution: true,
  },
  {
    key: "mem_has_bank_account",
    label: "Has a checking or savings account",
    kind: "binary",
    find: (t) => /(checking|savings|bank|credit union)[^.?]{0,40}account/.test(t) && /\b(have|has|own|hold|had)\b/.test(t) && !/(overdraft|fee|closed|prepaid|open(ed)? a new|interest|balance|how many|deposit|retirement|health savings|\bira\b|401)/.test(t) && !NOT_INCIDENCE.test(t),
    prefer: [(t) => /checking (or|and|and\/or) savings/.test(t), (t) => /(bank|credit union)/.test(t)],
    classify: yesNo,
  },
  {
    key: "mem_used_payday_loan",
    label: "Used a payday loan",
    kind: "binary",
    find: (t) => afsProducts(t).join() === "payday" && !NOT_INCIDENCE.test(t),
    prefer: [(t) => TWELVE_MONTHS.test(t), (t) => !/\bever\b/.test(t)],
    classify: yesOrCount,
    stress: true,
  },
  {
    key: "mem_used_pawn_loan",
    label: "Used a pawn loan",
    kind: "binary",
    find: (t) => afsProducts(t).join() === "pawn" && !NOT_INCIDENCE.test(t),
    prefer: [(t) => TWELVE_MONTHS.test(t), (t) => !/\bever\b/.test(t)],
    classify: yesOrCount,
  },
  {
    key: "mem_used_auto_title_loan",
    label: "Used an auto title loan",
    kind: "binary",
    find: (t) => afsProducts(t).join() === "title" && !NOT_INCIDENCE.test(t),
    prefer: [(t) => TWELVE_MONTHS.test(t), (t) => !/\bever\b/.test(t)],
    classify: yesOrCount,
  },
  {
    key: "mem_used_other_afs",
    label: "Used check cashing, rent-to-own or a refund anticipation product",
    kind: "binary",
    find: (t) => afsProducts(t).join() === "other" && !NOT_INCIDENCE.test(t),
    prefer: [(t) => !/\bever\b/.test(t)],
    classify: yesOrCount,
    union: true,
  },
  {
    key: "mem_used_any_afs",
    label: "Used a payday, pawn or auto title loan or another alternative financial service",
    kind: "binary",
    find: (t) => afsProducts(t).length > 0 && !NOT_INCIDENCE.test(t),
    prefer: [(t) => !/\bever\b/.test(t)],
    classify: yesOrCount,
    union: true,
    stress: true,
  },
  {
    key: "mem_difficulty_paying_bills",
    label: "Had difficulty paying bills or expenses",
    kind: "binary",
    find: (t) =>
      /(difficult|trouble|hard|struggl|unable|could not|couldn'?t|not able)[^.?]{0,80}(pay|paying|afford|cover|meet)[^.?]{0,60}(bills?|expenses|obligations)/.test(t) &&
      !NOT_INCIDENCE.test(t) &&
      !/(which|what (type|kind)|unexpected|emergency)/.test(t),
    prefer: [(t) => /(bills?|expenses)/.test(t) && /(12 months|past year|month)/.test(t), (t) => /(usual|regular|monthly|bills and expenses|bill or expense)/.test(t)],
    classify: difficulty,
    stress: true,
  },
  {
    key: "mem_could_cover_emergency_expense",
    label: "Could cover an unexpected expense",
    kind: "binary",
    find: (t) => /(unexpected|emergency|unplanned)[^.?]{0,60}(expense|cost|bill)/.test(t) && /(cover|pay for|handle|come up with)/.test(t) && !/(how would|which|what (would|did)|source|method|how did)/.test(t),
    prefer: [(t) => /(\$\s?[\d,]+)/.test(t)],
    classify: couldCover,
    stress: true,
  },
  {
    key: "mem_has_emergency_savings",
    label: "Has emergency or rainy-day savings",
    kind: "binary",
    find: (t) => (/(emergency|rainy[ -]day)[^.?]{0,30}(savings|fund)/.test(t) || /savings[^.?]{0,40}(emergency|unexpected)/.test(t)) && !/(how much|amount|how many months|how long)/.test(t),
    prefer: [(t) => /\b(have|has)\b/.test(t)],
    classify: yesNo,
    stress: true,
  },
  {
    key: "mem_paid_late_fee",
    label: "Paid a late fee",
    kind: "binary",
    find: (t) => (/late (fee|charge|payment fee|payment charge)/.test(t) || /(fee|charge)[^.?]{0,40}(paying|paid|pay)[^.?]{0,20}late/.test(t)) && !NOT_INCIDENCE.test(t) && !/overdraft/.test(t),
    prefer: [(t) => TWELVE_MONTHS.test(t)],
    classify: yesOrCount,
    stress: true,
  },
  {
    key: "mem_credit_score_band",
    label: "Credit score band (credit record)",
    kind: "distribution",
    find: (t) => /(credit score|risk score|vantage|fico|credit (rating|band|tier))/.test(t) && !/(self[ -]?(reported|rated|assess)|how would you (rate|describe)|do you know|check(ed)? your|you think|your own)/.test(t),
    prefer: [(t) => /(band|range|tier|categor|bucket|group)/.test(t), (t) => /(credit record|bureau|vantage|fico|risk)/.test(t)],
    stress: true,
  },
];

export type DimensionKey = "weight" | "wave" | "income" | "region" | "state";

export const MEM_DIMENSIONS: Record<DimensionKey, { find: (t: string) => boolean; prefer: Array<(t: string) => boolean> }> = {
  weight: {
    find: (t) => /\bweights?\b/.test(t) && !/(replicate|\brep(licate)? ?wt|height|weight loss|body)/.test(t),
    prefer: [(t) => /(survey|sampl(e|ing)|final|analysis|cross[ -]?section|base|respondent) weight/.test(t), (t) => !/(panel|longitudinal)/.test(t)],
  },
  wave: {
    find: (t) => /\b(wave|survey year|survey round|year of (the )?survey|interview year|data year|year surveyed)\b/.test(t) || /^year\b/.test(t),
    prefer: [(t) => /(wave|survey year)/.test(t)],
  },
  income: {
    find: (t) => /\bincome\b/.test(t) && !/(change|drop|decrease|increase|volatil|var(y|ies|iation|iable)|spike|unexpected|irregular|source|tax|refund|lost|loss|ratio|percent|shortfall|enough)/.test(t),
    prefer: [(t) => /(household|family)/.test(t), (t) => /(annual|yearly|total|before taxes|pre-?tax)/.test(t)],
  },
  region: {
    find: (t) => /\bregion\b/.test(t) && !/(division|sub-?region|cbsa|metro)/.test(t),
    prefer: [(t) => /census/.test(t)],
  },
  state: {
    find: (t) => /\bstate\b/.test(t) && /(resid|live|state of|respondent|household)/.test(t) && !/(statement|status|united states|estate|financial state)/.test(t),
    prefer: [(t) => /residen/.test(t)],
  },
};

export interface Candidate {
  variable: string;
  text: string;
}

/** Codebook entries for a wording test, narrowed by the tie-breakers. Only variables in the data. */
export function findCandidates(codebook: Codebook, headers: string[], find: (t: string) => boolean, prefer: Array<(t: string) => boolean>): { all: Candidate[]; chosen: Candidate[] } {
  const inData = new Set(headers.map((h) => h.trim().toLowerCase()));
  let list = codebook.entries
    .filter((e) => inData.has(e.variable.toLowerCase()))
    .map((e) => ({ variable: e.variable, text: e.text.toLowerCase() }))
    .filter((e) => find(e.text));
  const all = list;
  for (const p of prefer) {
    if (list.length <= 1) break;
    const kept = list.filter((c) => p(c.text));
    if (kept.length > 0) list = kept;
  }
  return { all, chosen: list };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** The header row of a CSV text (first record). */
export function csvHeaders(text: string): string[] {
  const end = text.indexOf("\n");
  const first = end < 0 ? text : text.slice(0, end);
  return (parseCsvTable(first)[0] ?? []).map((h) => h.trim());
}

/** Reads only the named columns of a CSV text, as records keyed by the header spelling. */
export function readColumns(text: string, columns: string[]): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  let idx: Array<[string, number]> | null = null;
  const wanted = new Set(columns.map((c) => c.toLowerCase()));
  const parser = new CsvStreamParser((row) => {
    if (!idx) {
      idx = row.map((h, i) => [h.trim(), i] as [string, number]).filter(([h]) => wanted.has(h.toLowerCase()));
      return;
    }
    if (row.length === 1 && row[0].trim() === "") return;
    const rec: Record<string, string> = {};
    for (const [h, i] of idx) rec[h] = row[i] ?? "";
    out.push(rec);
  });
  parser.push(text);
  parser.end();
  return out;
}

export interface DataFile {
  name: string;
  url: string;
  text: string;
  /** Wave read from the file name ("..._2019_...") when the data has no wave column. */
  waveFromName: string | null;
}

/** A wave year in a data file's name, only when named as a wave or survey year. */
export function waveFromFileName(name: string): string | null {
  const base = decodeURIComponent(name.split("/").pop() ?? "").toLowerCase();
  const m = /(?:wave|survey|mem|puf)[-_ ]?(20[12]\d)(?![\d-])|(?<![\d-])(20[12]\d)[-_ ]?(?:wave|survey)/.exec(base);
  return m ? (m[1] ?? m[2]) : null;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

interface Tally {
  respondents: number;
  positives: number;
  weight: number;
  weightPositive: number;
}

const newTally = (): Tally => ({ respondents: 0, positives: 0, weight: 0, weightPositive: 0 });

function addTally(t: Tally, positive: boolean, weight: number) {
  t.respondents += 1;
  t.weight += weight;
  if (positive) {
    t.positives += 1;
    t.weightPositive += weight;
  }
}

const share = (t: Tally) => (t.weight > 0 ? Math.round((t.weightPositive / t.weight) * 10_000) / 100 : null);

function labelMap(entry: CodebookEntry | undefined): Map<string, string> {
  return new Map((entry?.labels ?? []).map((l) => [l.code, l.label]));
}

/** The label an answer carries: the codebook's label for its code, or the data's own text. Null when blank. */
export function answerLabel(labels: Map<string, string>, raw: string | undefined): { label: string | null; unlabelled: string | null } {
  const v = (raw ?? "").trim();
  if (v === "" || v === ".") return { label: null, unlabelled: null };
  const mapped = labels.get(normCode(v));
  if (mapped) return { label: mapped, unlabelled: null };
  if (!isNumeric(v)) return { label: norm(v), unlabelled: null };
  return { label: null, unlabelled: v };
}

export interface VariableUse {
  variable: string;
  wording: string;
  respondents: number;
  missingAnswers: number;
  /** Labels (or codes with no label) the measure could not place; when any, the variable is not used. */
  unclassified: string[];
  usable: boolean;
}

export interface QuestionReport {
  key: string;
  label: string;
  /** Every codebook variable whose wording matched, in the data file. */
  matched: Candidate[];
  /** The variable(s) used after tie-breakers, or none when still ambiguous. */
  chosen: string[];
  ambiguous: boolean;
}

export interface WaveReport {
  wave: string;
  rows: number;
  rowsWithoutWeight: number;
  /** Per measure: the variables used this wave with their counts, or null when not found/usable. */
  measures: Record<string, VariableUse[] | null>;
}

export interface MemReport {
  codebookFormat: Codebook["format"] | null;
  codebookEntries: number;
  weight: { variable: string | null; wording: string | null; candidates: Candidate[] };
  waveVariable: string | null;
  waveCandidates: Candidate[];
  dimensions: Record<"income" | "region" | "state", { variable: string | null; candidates: Candidate[]; problem: string | null }>;
  questions: QuestionReport[];
  waves: WaveReport[];
  overdraftQuestionInPublicFile: boolean;
  overdraftWording: string | null;
  /** Codebook variables absent from the data, and data columns the codebook does not document. */
  unexpected: { codebookOnly: number; codebookOnlyExamples: string[]; undocumented: number; undocumentedExamples: string[] };
}

const REGIONS: Record<string, string> = { northeast: "Northeast", midwest: "Midwest", "north central": "Midwest", south: "South", west: "West" };

function regionOf(label: string): string | null {
  const l = label.toLowerCase();
  for (const [k, v] of Object.entries(REGIONS)) if (new RegExp(`\\b${k}\\b`).test(l)) return v;
  return null;
}

/** Waves "2019" or "2020-06": a 4-digit year from the value or its label, with the month when the label names one. */
export function wavePeriod(code: string, label: string | null): { year: string; month: string | null } | null {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const text = `${label ?? ""} ${code}`.toLowerCase();
  const y = /\b(20[12]\d)\b/.exec(text);
  if (!y) return null;
  const mi = months.findIndex((m) => new RegExp(`\\b${m}[a-z]*\\b`).test(text));
  return { year: y[1], month: mi >= 0 ? String(mi + 1).padStart(2, "0") : null };
}

interface Breakout {
  dimension: "national" | "income" | "region" | "state";
  category: string;
}

export interface ComputeInput {
  codebook: Codebook;
  files: Array<{ name: string; url: string; headers: string[]; rows: Array<Record<string, string>>; waveFromName: string | null }>;
}

/** Variables the computation reads, so a large data file can be read column by column. */
export function plannedColumns(codebook: Codebook, headers: string[]): string[] {
  const out = new Set<string>();
  for (const m of MEM_MEASURES) for (const c of findCandidates(codebook, headers, m.find, m.prefer).all) out.add(c.variable);
  for (const d of Object.values(MEM_DIMENSIONS)) for (const c of findCandidates(codebook, headers, d.find, d.prefer).all) out.add(c.variable);
  const inData = new Map(headers.map((h) => [h.toLowerCase(), h]));
  return [...out].map((v) => inData.get(v.toLowerCase()) ?? v);
}

function pickOne(codebook: Codebook, headers: string[], key: DimensionKey) {
  const d = MEM_DIMENSIONS[key];
  const { all, chosen } = findCandidates(codebook, headers, d.find, d.prefer);
  return { all, chosen: chosen.length === 1 ? chosen[0] : null };
}

/**
 * Weighted shares per wave. Pure. Every measure's answers are read through the codebook's labels;
 * a variable with an answer label the measure cannot place as yes/no is reported and not used.
 */
export function computeMakingEndsMeet(input: ComputeInput, sourceUrl: string | null): AreaFetch & { report: MemReport } {
  const { codebook } = input;
  const headers = [...new Set(input.files.flatMap((f) => f.headers))];
  const entryOf = new Map(codebook.entries.map((e) => [e.variable.toLowerCase(), e]));
  const headerOf = new Map(headers.map((h) => [h.toLowerCase(), h]));
  const col = (variable: string) => headerOf.get(variable.toLowerCase()) ?? variable;

  const inData = new Set(headers.map((h) => h.toLowerCase()));
  const codebookOnly = codebook.entries.filter((e) => !inData.has(e.variable.toLowerCase())).map((e) => e.variable);
  const undocumented = headers.filter((h) => !entryOf.has(h.toLowerCase()));

  const weight = pickOne(codebook, headers, "weight");
  const wave = pickOne(codebook, headers, "wave");
  const dims = {
    income: pickOne(codebook, headers, "income"),
    region: pickOne(codebook, headers, "region"),
    state: pickOne(codebook, headers, "state"),
  };

  const questions: QuestionReport[] = MEM_MEASURES.map((m) => {
    const { all, chosen } = findCandidates(codebook, headers, m.find, m.prefer);
    const ambiguous = !m.union && chosen.length > 1;
    return { key: m.key, label: m.label, matched: all, chosen: ambiguous ? [] : chosen.map((c) => c.variable), ambiguous };
  });
  const od = questions.find((q) => q.key === OVERDRAFT_KEY)!;

  const report: MemReport = {
    codebookFormat: codebook.format,
    codebookEntries: codebook.entries.length,
    weight: { variable: weight.chosen?.variable ?? null, wording: weight.chosen?.text ?? null, candidates: weight.all },
    waveVariable: wave.chosen?.variable ?? null,
    waveCandidates: wave.all,
    dimensions: {
      income: { variable: null, candidates: dims.income.all, problem: null },
      region: { variable: null, candidates: dims.region.all, problem: null },
      state: { variable: null, candidates: dims.state.all, problem: null },
    },
    questions,
    waves: [],
    overdraftQuestionInPublicFile: od.matched.length > 0,
    overdraftWording: od.matched[0]?.text ?? null,
    unexpected: { codebookOnly: codebookOnly.length, codebookOnlyExamples: codebookOnly.slice(0, 10), undocumented: undocumented.length, undocumentedExamples: undocumented.slice(0, 10) },
  };

  const missingFields: string[] = [];
  if (!weight.chosen) missingFields.push(weight.all.length > 1 ? `survey weight (ambiguous: ${weight.all.map((c) => c.variable).join(", ")})` : "survey weight (no codebook entry worded as a weight)");
  for (const q of questions) {
    if (q.matched.length === 0) missingFields.push(`${q.key} (no question with this wording)`);
    else if (q.ambiguous) missingFields.push(`${q.key} (ambiguous: ${q.matched.map((c) => c.variable).join(", ")})`);
  }
  if (!weight.chosen) {
    return { url: sourceUrl, rows: [], missingFields, skipped: {}, emptyReason: "The codebook names no single survey weight; no weighted share can be computed", report };
  }
  const weightCol = col(weight.chosen.variable);

  // Dimension label maps, validated against what the labels say.
  const incomeLabels = dims.income.chosen ? labelMap(entryOf.get(dims.income.chosen.variable.toLowerCase())) : null;
  if (dims.income.chosen) {
    const ls = [...(incomeLabels?.values() ?? [])].filter((l) => !MISSING_LABEL.test(l.toLowerCase()));
    if (ls.filter((l) => /\$|\d/.test(l)).length >= 2 || (incomeLabels?.size ?? 0) === 0) report.dimensions.income.variable = dims.income.chosen.variable;
    else report.dimensions.income.problem = "income variable has no dollar-band value labels";
  } else if (dims.income.all.length > 1) report.dimensions.income.problem = "ambiguous";
  const regionLabels = dims.region.chosen ? labelMap(entryOf.get(dims.region.chosen.variable.toLowerCase())) : null;
  if (dims.region.chosen) {
    const found = new Set([...(regionLabels?.values() ?? [])].map(regionOf).filter(Boolean));
    if (found.size >= 3 || (regionLabels?.size ?? 0) === 0) report.dimensions.region.variable = dims.region.chosen.variable;
    else report.dimensions.region.problem = "region labels are not the four Census regions";
  } else if (dims.region.all.length > 1) report.dimensions.region.problem = "ambiguous";
  const stateLabels = dims.state.chosen ? labelMap(entryOf.get(dims.state.chosen.variable.toLowerCase())) : null;
  if (dims.state.chosen) {
    const mapped = [...(stateLabels?.values() ?? [])].map((l) => stateCodeFromName(l)).filter(Boolean);
    if (mapped.length >= 40 || (stateLabels?.size ?? 0) === 0) report.dimensions.state.variable = dims.state.chosen.variable;
    else report.dimensions.state.problem = "state labels do not name states";
  } else if (dims.state.all.length > 1) report.dimensions.state.problem = "ambiguous";

  // Rows grouped by wave.
  const waveLabels = wave.chosen ? labelMap(entryOf.get(wave.chosen.variable.toLowerCase())) : new Map<string, string>();
  const byWave = new Map<string, Array<Record<string, string>>>();
  const skipped: Record<string, number> = {};
  const waveCodes = new Map<string, { year: string; month: string | null }>();
  for (const file of input.files) {
    for (const row of file.rows) {
      let key: string | null = null;
      if (wave.chosen) {
        const raw = (row[col(wave.chosen.variable)] ?? "").trim();
        const p = raw ? wavePeriod(raw, waveLabels.get(normCode(raw)) ?? null) : null;
        if (p) {
          waveCodes.set(normCode(raw), p);
          key = normCode(raw);
        }
      } else if (file.waveFromName) {
        key = `file:${file.waveFromName}`;
        waveCodes.set(key, { year: file.waveFromName, month: null });
      }
      if (!key) {
        skipped.unreadable_wave = (skipped.unreadable_wave ?? 0) + 1;
        continue;
      }
      const list = byWave.get(key);
      if (list) list.push(row);
      else byWave.set(key, [row]);
    }
  }
  // Period per wave code: the year, or year-month when two waves share a year.
  const yearCount = new Map<string, number>();
  for (const p of waveCodes.values()) yearCount.set(p.year, (yearCount.get(p.year) ?? 0) + 1);
  const periodOf = (code: string): string | null => {
    const p = waveCodes.get(code)!;
    if ((yearCount.get(p.year) ?? 0) <= 1) return p.year;
    return p.month ? `${p.year}-${p.month}` : null;
  };

  const out: AreaStat[] = [];
  const waveOrder = [...byWave.keys()].sort((a, b) => (periodOf(b) ?? "").localeCompare(periodOf(a) ?? ""));
  for (const code of waveOrder) {
    const period = periodOf(code);
    const rows = byWave.get(code)!;
    if (!period) {
      skipped.ambiguous_wave_period = (skipped.ambiguous_wave_period ?? 0) + rows.length;
      continue;
    }
    const waveReport: WaveReport = { wave: period, rows: rows.length, rowsWithoutWeight: 0, measures: {} };
    report.waves.push(waveReport);
    const weights = rows.map((r) => {
      const w = publishedNumber(r[weightCol]);
      return w !== null && w > 0 ? w : null;
    });
    waveReport.rowsWithoutWeight = weights.filter((w) => w === null).length;

    const breakoutsOf = (row: Record<string, string>): Breakout[] => {
      const b: Breakout[] = [{ dimension: "national", category: "US" }];
      if (report.dimensions.income.variable && incomeLabels) {
        const { label } = answerLabel(incomeLabels, row[col(report.dimensions.income.variable)]);
        if (label && !MISSING_LABEL.test(label.toLowerCase())) b.push({ dimension: "income", category: label });
      }
      if (report.dimensions.region.variable && regionLabels) {
        const { label } = answerLabel(regionLabels, row[col(report.dimensions.region.variable)]);
        const region = label ? regionOf(label) : null;
        if (region) b.push({ dimension: "region", category: region });
      }
      if (report.dimensions.state.variable && stateLabels) {
        const { label } = answerLabel(stateLabels, row[col(report.dimensions.state.variable)]);
        const st = label ? stateCodeFromName(label) : null;
        if (st) b.push({ dimension: "state", category: st });
      }
      return b;
    };
    const rowBreakouts = rows.map(breakoutsOf);

    // Per-row verdict for every binary measure; per-row label for distribution measures.
    const verdicts = new Map<string, Array<Verdict>>();
    const categories = new Map<string, Array<string | null>>();
    for (const m of MEM_MEASURES) {
      const q = questions.find((x) => x.key === m.key)!;
      if (q.chosen.length === 0) {
        waveReport.measures[m.key] = null;
        continue;
      }
      const uses: VariableUse[] = [];
      const perVar: Array<{ use: VariableUse; answers: Array<{ verdict: Verdict; label: string | null }> }> = [];
      for (const variable of q.chosen) {
        const entry = entryOf.get(variable.toLowerCase());
        const labels = labelMap(entry);
        const use: VariableUse = { variable, wording: (entry?.text ?? "").slice(0, 240), respondents: 0, missingAnswers: 0, unclassified: [], usable: false };
        const unclassified = new Set<string>();
        const answers = rows.map((row) => {
          const { label, unlabelled } = answerLabel(labels, row[col(variable)]);
          if (unlabelled !== null) {
            unclassified.add(`code ${unlabelled} (no label)`);
            return { verdict: null, label: null };
          }
          if (label === null) return { verdict: null, label: null };
          if (MISSING_LABEL.test(label.toLowerCase())) {
            use.missingAnswers += 1;
            return { verdict: null, label: null };
          }
          if (m.kind === "distribution") {
            use.respondents += 1;
            return { verdict: null, label };
          }
          const v = m.classify!(label.toLowerCase());
          if (v === null) {
            unclassified.add(label);
            return { verdict: null, label };
          }
          use.respondents += 1;
          return { verdict: v, label };
        });
        use.unclassified = [...unclassified].slice(0, 12);
        use.usable = use.respondents > 0 && unclassified.size === 0;
        if (use.respondents > 0 || unclassified.size > 0) uses.push(use);
        if (use.usable) perVar.push({ use, answers });
      }
      waveReport.measures[m.key] = uses.length > 0 ? uses : null;
      if (perVar.length === 0 || (!m.union && perVar.length !== 1)) continue;
      if (m.kind === "distribution") {
        categories.set(m.key, perVar[0].answers.map((a) => a.label));
        continue;
      }
      verdicts.set(
        m.key,
        rows.map((_, i) => {
          const vs = perVar.map((p) => p.answers[i].verdict);
          if (vs.includes("pos")) return "pos";
          if (vs.includes("neg")) return "neg";
          return null;
        }),
      );
      if (m.distribution && perVar.length === 1) {
        // Count bands ("1 time", "2-3 times"), only when the question has more than one "yes" answer.
        const positive = new Set(perVar[0].answers.filter((a) => a.verdict === "pos").map((a) => a.label));
        if (positive.size > 1) categories.set(`${m.key}_times`, perVar[0].answers.map((a) => a.label));
      }
    }

    const variablesOf = (key: string) => (waveReport.measures[key.replace(/_times$/, "")] ?? []).filter((u) => u.usable).map((u) => u.variable);
    const base = (series: string, value: number | null, raw: Record<string, unknown>, respondents: number, b: Breakout): AreaStat => ({
      geo_type: b.dimension === "state" ? "state" : "nation",
      geo_code: b.dimension === "state" ? b.category : "US",
      geo_name: b.dimension === "state" ? b.category : "United States",
      state_code: b.dimension === "state" ? b.category : null,
      period,
      series_key: series,
      value,
      unit: "percent",
      note: respondents < MEM_SMALL_SAMPLE ? `fewer than ${MEM_SMALL_SAMPLE} respondents` : null,
      raw: { ...raw, wave: period, weight_variable: weight.chosen!.variable, breakout: b.dimension === "national" ? null : b },
    });
    const suffix = (b: Breakout) => (b.dimension === "income" ? `_by_income_${seriesSlug(b.category)}` : b.dimension === "region" ? `_by_region_${seriesSlug(b.category)}` : "");

    // Binary measures by breakout.
    for (const [key, vs] of verdicts) {
      const cells = new Map<string, { b: Breakout; t: Tally }>();
      vs.forEach((v, i) => {
        const w = weights[i];
        if (v === null || w === null) return;
        for (const b of rowBreakouts[i]) {
          const k = `${b.dimension}|${b.category}`;
          const cell = cells.get(k) ?? { b, t: newTally() };
          addTally(cell.t, v === "pos", w);
          cells.set(k, cell);
        }
      });
      const label = MEM_MEASURES.find((m) => m.key === key)!.label;
      for (const { b, t } of cells.values()) {
        out.push(base(`${key}${suffix(b)}`, share(t), { measure: label, variables: variablesOf(key), respondents: t.respondents, positive_respondents: t.positives, weighted_base: Math.round(t.weight * 100) / 100 }, t.respondents, b));
      }
    }

    // Distributions (credit score band, overdraft count bands): share of respondents per label.
    for (const [key, labels] of categories) {
      if (labels.length === 0) continue;
      const cells = new Map<string, { b: Breakout; total: Tally; byLabel: Map<string, number> }>();
      labels.forEach((label, i) => {
        const w = weights[i];
        if (label === null || w === null) return;
        for (const b of rowBreakouts[i]) {
          if (b.dimension !== "national") continue;
          const k = `${b.dimension}|${b.category}`;
          const cell = cells.get(k) ?? { b, total: newTally(), byLabel: new Map() };
          addTally(cell.total, false, w);
          cell.byLabel.set(label, (cell.byLabel.get(label) ?? 0) + w);
          cells.set(k, cell);
        }
      });
      for (const { b, total } of cells.values()) {
        const counts = new Map<string, number>();
        labels.forEach((l, i) => {
          if (l !== null && weights[i] !== null) counts.set(l, (counts.get(l) ?? 0) + 1);
        });
        for (const [label, w] of cells.get(`${b.dimension}|${b.category}`)!.byLabel) {
          const n = counts.get(label) ?? 0;
          out.push(base(`${key}_${seriesSlug(label)}`, Math.round((w / total.weight) * 10_000) / 100, { measure: `${key} distribution`, category: label, variables: variablesOf(key), respondents: n, base_respondents: total.respondents }, total.respondents, b));
        }
      }
    }

    // Overdraft payers versus non-payers on the stress measures (national only).
    const odv = verdicts.get(OVERDRAFT_KEY);
    if (odv) {
      for (const m of MEM_MEASURES.filter((x) => x.stress)) {
        for (const group of ["pos", "neg"] as const) {
          const suffixKey = group === "pos" ? "among_od_payers" : "among_od_nonpayers";
          const nat: Breakout = { dimension: "national", category: "US" };
          const groupRows = odv.map((v, i) => (v === group && weights[i] !== null ? i : -1)).filter((i) => i >= 0);
          if (m.kind === "binary") {
            const vs = verdicts.get(m.key);
            if (!vs) continue;
            const t = newTally();
            for (const i of groupRows) if (vs[i] !== null) addTally(t, vs[i] === "pos", weights[i]!);
            if (t.respondents === 0) continue;
            out.push(base(`${m.key}_${suffixKey}`, share(t), { measure: m.label, group: suffixKey, overdraft_variable: od.chosen[0] ?? null, variables: variablesOf(m.key), respondents: t.respondents, positive_respondents: t.positives, weighted_base: Math.round(t.weight * 100) / 100 }, t.respondents, nat));
          } else {
            const labels = categories.get(m.key);
            if (!labels) continue;
            let total = 0;
            let n = 0;
            const byLabel = new Map<string, { w: number; n: number }>();
            for (const i of groupRows) {
              const l = labels[i];
              if (l === null) continue;
              total += weights[i]!;
              n += 1;
              const c = byLabel.get(l) ?? { w: 0, n: 0 };
              c.w += weights[i]!;
              c.n += 1;
              byLabel.set(l, c);
            }
            for (const [label, c] of byLabel) {
              out.push(base(`${m.key}_${seriesSlug(label)}_${suffixKey}`, Math.round((c.w / total) * 10_000) / 100, { measure: `${m.label} distribution`, category: label, group: suffixKey, respondents: c.n, base_respondents: n }, n, nat));
            }
          }
        }
      }
    }
  }

  if (!report.overdraftQuestionInPublicFile) missingFields.push("overdraft fee question: not in the public file (nothing loaded for it)");
  return {
    url: sourceUrl,
    rows: out,
    missingFields,
    skipped,
    emptyReason: out.length === 0 ? (report.waves.length === 0 ? "No row carried a readable survey wave" : "No question could be summarised for any wave; see the questions report") : null,
    report,
  };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface MemLinks {
  data: string[];
  unreadableData: string[];
  codebooks: string[];
  userGuides: string[];
}

const FILE_LINK = /href="([^"]+\.(?:csv|zip|xlsx|xls|pdf|dta|sas7bdat|sav|xpt|txt)(?:\?[^"]*)?)"/gi;

/** File links on a CFPB page, sorted into data, codebook and user guide. */
export function classifyMemLinks(html: string, pageUrl: string): MemLinks {
  const links = findListLinks(html, FILE_LINK, pageUrl).filter((u) => /making[-_ ]?ends[-_ ]?meet|\bmem[-_]|public[-_]use/i.test(decodeURIComponent(u)));
  const out: MemLinks = { data: [], unreadableData: [], codebooks: [], userGuides: [] };
  for (const url of links) {
    const name = decodeURIComponent(url.split("?")[0]).toLowerCase();
    if (/user[-_ ]?guide|technical|methodology/.test(name)) out.userGuides.push(url);
    else if (/codebook|code[-_ ]book|dictionary|variable[-_ ]list|data[-_ ]documentation/.test(name)) out.codebooks.push(url);
    else if (/\.(csv|zip)$/.test(name)) out.data.push(url);
    else if (/\.(dta|sas7bdat|sav|xpt)$/.test(name)) out.unreadableData.push(url);
  }
  return out;
}

async function tryFetch(url: string, options: RegistryFetchOptions): Promise<{ bytes: Uint8Array } | { status: string }> {
  try {
    const response = await registryFetch(url, options);
    return { bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    if (error instanceof RegistryHttpError) return { status: error.status === null ? error.message : `HTTP ${error.status}` };
    throw error;
  }
}

/** Data files from downloaded bytes: a CSV, or every CSV in a zip (codebook files in the zip returned apart). */
export function unpackData(url: string, bytes: Uint8Array): { files: DataFile[]; codebookFiles: Array<{ name: string; bytes: Uint8Array }>; other: string[] } {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return { files: [{ name: url, url, text: strFromU8(bytes, true).replace(/^﻿/, ""), waveFromName: waveFromFileName(url) }], codebookFiles: [], other: [] };
  const entries = unzipSync(bytes);
  const files: DataFile[] = [];
  const codebookFiles: Array<{ name: string; bytes: Uint8Array }> = [];
  const other: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const lower = name.toLowerCase();
    if (/codebook|dictionary|variable[-_ ]list/.test(lower) && /\.(csv|xlsx|pdf|txt)$/.test(lower)) codebookFiles.push({ name, bytes: data });
    else if (/\.csv$/.test(lower)) files.push({ name, url, text: strFromU8(data, true).replace(/^﻿/, ""), waveFromName: waveFromFileName(name) });
    else if (!name.endsWith("/")) other.push(name);
  }
  return { files, codebookFiles, other };
}

/** Codebook entries from bytes: xlsx/csv tables, else PDF or plain text anchored on the data's columns. */
export async function readCodebook(name: string, bytes: Uint8Array, headers: string[]): Promise<Codebook | null> {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (isPdf) {
    const { extractText } = await import("unpdf");
    const { text } = await extractText(bytes, { mergePages: false });
    const book = parseTextCodebook((text as string[]).join("\n"), headers);
    return book.entries.length > 0 ? book : null;
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.(csv|xlsx)$/i.test(name)) {
    const table = parseTableCodebook(readTableRows(bytes).rows);
    if (table && table.entries.length > 0) return table;
  }
  if (isZip) return null;
  const book = parseTextCodebook(strFromU8(bytes, true), headers);
  return book.entries.length > 0 ? book : null;
}

export interface MemFetch extends AreaFetch {
  unexpectedFields: string[];
  report: MemReport | null;
  transport: {
    pages: Record<string, string>;
    dataTried: Record<string, string>;
    codebookTried: Record<string, string>;
    unreadableData: string[];
    dataFiles: Array<{ name: string; rows: number; columns: number }>;
    codebookUrl: string | null;
    userGuideUrl: string;
  };
}

const splitUrls = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Downloads the public-use data and codebook and computes every wave. Never throws for a missing
 * file: the result is empty with the reason and every URL tried.
 */
export async function fetchMakingEndsMeet(env: Record<string, string | undefined>, options: RegistryFetchOptions = {}): Promise<MemFetch> {
  const transport: MemFetch["transport"] = { pages: {}, dataTried: {}, codebookTried: {}, unreadableData: [], dataFiles: [], codebookUrl: null, userGuideUrl: MEM_USER_GUIDE_URL };
  const empty = (reason: string, missing: string[] = [], report: MemReport | null = null): MemFetch => ({ url: null, rows: [], missingFields: missing, unexpectedFields: [], skipped: {}, emptyReason: reason, report, transport });

  const found: MemLinks = { data: [], unreadableData: [], codebooks: [], userGuides: [] };
  for (const page of MEM_PAGE_URLS) {
    const r = await tryFetch(page, { timeoutMs: 60_000, ...options });
    if ("status" in r) {
      transport.pages[page] = r.status;
      continue;
    }
    const links = classifyMemLinks(strFromU8(r.bytes, true), page);
    transport.pages[page] = `ok: ${links.data.length} data, ${links.codebooks.length} codebook, ${links.unreadableData.length} non-CSV data links`;
    for (const k of Object.keys(found) as Array<keyof MemLinks>) for (const u of links[k]) if (!found[k].includes(u)) found[k].push(u);
  }
  transport.unreadableData = found.unreadableData;
  if (found.userGuides[0]) transport.userGuideUrl = found.userGuides[0];

  const dataUrls = splitUrls(env[MEM_DATA_URL_ENV]).length > 0 ? splitUrls(env[MEM_DATA_URL_ENV]) : found.data.length > 0 ? found.data : MEM_KNOWN_DATA_URLS;
  const codebookUrls = splitUrls(env[MEM_CODEBOOK_URL_ENV]).length > 0 ? splitUrls(env[MEM_CODEBOOK_URL_ENV]) : found.codebooks.length > 0 ? found.codebooks : [...MEM_GUESS_CODEBOOK_URLS];

  const files: DataFile[] = [];
  const zipCodebooks: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const url of dataUrls.slice(0, 8)) {
    const r = await tryFetch(url, { timeoutMs: 300_000, ...options });
    if ("status" in r) {
      transport.dataTried[url] = r.status;
      continue;
    }
    const unpacked = unpackData(url, r.bytes);
    transport.dataTried[url] = `ok: ${unpacked.files.length} CSV file(s)${unpacked.other.length ? `; also ${unpacked.other.slice(0, 5).join(", ")}` : ""}`;
    files.push(...unpacked.files);
    zipCodebooks.push(...unpacked.codebookFiles);
  }
  if (files.length === 0) {
    const nonCsv = found.unreadableData.length > 0 ? `; the page lists only ${found.unreadableData.map((u) => u.split("/").pop()).join(", ")}, which are not read (no CSV)` : "";
    return empty(`No Making Ends Meet public-use CSV could be downloaded (tried ${Object.keys(transport.dataTried).join(", ") || "nothing"})${nonCsv}. Set ${MEM_DATA_URL_ENV} to the CSV or zip URL.`, ["public-use data file"]);
  }
  const headers = [...new Set(files.flatMap((f) => csvHeaders(f.text)))];

  // Each sample's zip carries its own codebook; all are read and merged (first entry per variable
  // wins) so a later sample's variables are documented too.
  let codebook: Codebook | null = null;
  for (const z of zipCodebooks) {
    const book = await readCodebook(z.name, z.bytes, headers);
    transport.codebookTried[`zip:${z.name}`] = book ? `ok: ${book.entries.length} entries` : "no entries read";
    if (!book) continue;
    if (!codebook) {
      codebook = { format: book.format, entries: [...book.entries] };
      transport.codebookUrl = `zip:${z.name}`;
      continue;
    }
    const known = new Set(codebook.entries.map((e) => e.variable.toLowerCase()));
    for (const e of book.entries) if (!known.has(e.variable.toLowerCase())) codebook.entries.push(e);
  }
  if (!codebook) {
    for (const url of codebookUrls.slice(0, 4)) {
      const r = await tryFetch(url, { timeoutMs: 120_000, ...options });
      if ("status" in r) {
        transport.codebookTried[url] = r.status;
        continue;
      }
      codebook = await readCodebook(url, r.bytes, headers);
      transport.codebookTried[url] = codebook ? `ok: ${codebook.entries.length} entries (${codebook.format})` : "downloaded; no variable entries read";
      if (codebook) {
        transport.codebookUrl = url;
        break;
      }
    }
  }
  if (!codebook) {
    return empty(`No codebook could be read (tried ${Object.keys(transport.codebookTried).join(", ") || "nothing"}); without question wording no variable is used. Set ${MEM_CODEBOOK_URL_ENV}.`, ["codebook"]);
  }

  const columns = plannedColumns(codebook, headers);
  const parsed = files.map((f) => {
    const rows = readColumns(f.text, columns);
    const fileHeaders = csvHeaders(f.text);
    transport.dataFiles.push({ name: f.name.split("/").pop() ?? f.name, rows: rows.length, columns: fileHeaders.length });
    return { name: f.name, url: f.url, headers: fileHeaders, rows, waveFromName: f.waveFromName };
  });
  const result = computeMakingEndsMeet({ codebook, files: parsed }, files[0].url);
  const unexpectedFields = [
    ...result.report.unexpected.codebookOnlyExamples.map((v) => `codebook only: ${v}`),
    ...result.report.unexpected.undocumentedExamples.map((v) => `undocumented column: ${v}`),
  ];
  return { ...result, unexpectedFields, transport };
}
