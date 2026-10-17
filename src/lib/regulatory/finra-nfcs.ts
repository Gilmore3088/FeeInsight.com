import { strFromU8, unzipSync } from "fflate";
import { extractText } from "unpdf";
import { STATE_NAMES } from "@/lib/us-states";
import { readTableRows } from "./designation-lists";
import type { AreaFetch, AreaStat } from "./economy";
import type { RegistryFetchOptions } from "./http";
import { parseCsvTable } from "./industry-events";
import { fetchFirstAvailable, isZip, pageLinks, valueWithFlag } from "./risk-costs";

/**
 * FINRA Foundation National Financial Capability Study (NFCS), state-by-state survey: weighted
 * state shares of adults for a few banking questions (has a checking account, overdraws it,
 * has three months of emergency funds, could not come up with $2,000 in a month, finds it hard
 * to cover monthly bills). Pure transport and parsing: no DB access.
 *
 * finrafoundation.org is blocked from the sandbox this was written in. The download page, the
 * file names, the variable names and the answer coding are from memory, so the loader does not
 * use remembered variable names: it reads the published codebook (or questionnaire) and finds
 * each question's variable by its wording, then checks that the respondent file holds that
 * variable and only the answer codes the question allows. A question it cannot find, or whose
 * codes do not fit, is reported and not computed. Numeric state codes are used only when the
 * codebook lists the 50 states and DC in alphabetical order (the order the codes follow);
 * otherwise nothing is computed.
 */

export const NFCS_PAGE = "https://www.finrafoundation.org/knowledge-we-gain-share/nfcs/data-and-downloads";
export const NFCS_DATA_URL_ENV = "NFCS_STATE_DATA_URL";
export const NFCS_CODEBOOK_URL_ENV = "NFCS_CODEBOOK_URL";
export const NFCS_WAVES = [2024, 2021, 2018] as const;

export interface NfcsQuestion {
  key: string;
  label: string;
  /** Wording matched in the codebook text (case-insensitive). */
  wording: RegExp;
  /** Answer codes counted toward the share, and every substantive code the question allows. */
  yes: number[];
  valid: number[];
  /** Words the codebook should show near the question for this coding (checked, reported). */
  codingWords: RegExp;
}

export const NFCS_QUESTIONS: NfcsQuestion[] = [
  { key: "nfcs_has_checking_account", label: "Has a checking account", wording: /have\b[^?.]{0,60}\bchecking account/i, yes: [1], valid: [1, 2], codingWords: /\byes\b[\s\S]{0,80}\bno\b/i },
  { key: "nfcs_overdraws_checking", label: "Overdraws the checking account occasionally", wording: /overdraw\b[^?.]{0,60}checking account/i, yes: [1], valid: [1, 2], codingWords: /\byes\b[\s\S]{0,80}\bno\b/i },
  {
    key: "nfcs_has_emergency_funds",
    label: "Has rainy day funds to cover 3 months of expenses",
    wording: /(rainy day|emergency)[^?]{0,120}(3|three) months/i,
    yes: [1],
    valid: [1, 2],
    codingWords: /\byes\b[\s\S]{0,80}\bno\b/i,
  },
  {
    key: "nfcs_could_not_cover_2000",
    label: "Probably or certainly could not come up with $2,000 within a month",
    wording: /come up with \$\s?2,?000/i,
    yes: [3, 4],
    valid: [1, 2, 3, 4],
    codingWords: /certainly could[\s\S]{0,200}probably could not/i,
  },
  {
    key: "nfcs_difficulty_covering_expenses",
    label: "Finds it very or somewhat difficult to cover monthly expenses and bills",
    wording: /how difficult is it for you to cover your expenses/i,
    yes: [1, 2],
    valid: [1, 2, 3],
    codingWords: /very difficult[\s\S]{0,120}not at all difficult/i,
  },
];

/** NFCS's numeric state codes, as remembered: 1-51 for the 50 states and DC in alphabetical order. */
export const ALPHABETICAL_STATES: Array<{ code: string; name: string }> = Object.entries(STATE_NAMES)
  .filter(([code]) => !["PR", "VI", "GU", "AS"].includes(code))
  .map(([code, name]) => ({ code, name: code === "DC" ? "District of Columbia" : name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Download and codebook links for one wave on the FINRA page. */
export function nfcsLinks(html: string, pageUrl: string, wave: number): { data: string[]; codebook: string[] } {
  const links = pageLinks(html, pageUrl).filter((l) => `${l.href} ${l.text}`.includes(String(wave)));
  const isState = (l: { href: string; text: string }) => /state/i.test(`${l.href} ${l.text}`);
  const doc = (l: { href: string; text: string }) => /codebook|questionnaire|dictionary|variable/i.test(`${l.href} ${l.text}`);
  const data = links.filter((l) => isState(l) && !doc(l) && /\.(csv|zip)(\?|$)/i.test(l.href)).map((l) => l.href);
  const codebook = links
    .filter((l) => doc(l) && /\.(xlsx|csv|pdf)(\?|$)/i.test(l.href))
    .sort((a, b) => Number(isState(b)) - Number(isState(a)) || Number(/\.pdf/i.test(a.href)) - Number(/\.pdf/i.test(b.href)))
    .map((l) => l.href);
  return { data, codebook };
}

/** Codebook bytes (xlsx, csv or pdf) as plain text, one line per row or page. */
export async function codebookText(bytes: Uint8Array): Promise<string> {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    const { text } = await extractText(bytes, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).join("\n");
  }
  return readTableRows(bytes)
    .rows.map((r) => r.filter(Boolean).join(" "))
    .join("\n");
}

/**
 * The respondent-file variable a question's wording belongs to: the nearest header name that
 * appears before the wording in the codebook text (within 300 characters), else just after it.
 */
export function findVariable(text: string, wording: RegExp, headers: string[]): { variable: string | null; context: string | null; at: number } {
  const names = headers.filter((h) => /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(h) && !/^wgt|^nfcsid$|^stateq?$/i.test(h));
  const global = new RegExp(wording.source, wording.flags.includes("g") ? wording.flags : `${wording.flags}g`);
  for (const m of text.matchAll(global)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 300), at);
    let best: { name: string; pos: number } | null = null;
    for (const name of names) {
      const re = new RegExp(`(?:^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "gi");
      for (const hit of before.matchAll(re)) {
        const pos = (hit.index ?? 0) + hit[0].length;
        if (!best || pos > best.pos) best = { name, pos };
      }
    }
    if (!best) {
      const after = text.slice(at, at + 120);
      for (const name of names) if (new RegExp(`(?:^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "i").test(after)) best = { name, pos: 0 };
    }
    if (best) return { variable: best.name, context: text.slice(Math.max(0, at - 40), at + 160).replace(/\s+/g, " "), at };
  }
  return { variable: null, context: null, at: -1 };
}

/** True when the codebook names the 50 states and DC in alphabetical order (after the state variable, if named). */
export function codebookConfirmsStateOrder(text: string, stateVariable: string): boolean {
  const start = Math.max(0, text.search(new RegExp(`(?:^|[^A-Za-z0-9_])${stateVariable}(?![A-Za-z0-9_])`, "i")));
  let at = start;
  for (const s of ALPHABETICAL_STATES) {
    const re = new RegExp(`\\b${s.name.replace(/ /g, "\\s+")}\\b`, "gi");
    re.lastIndex = at;
    const hit = re.exec(text);
    if (!hit) return false;
    at = hit.index + hit[0].length;
  }
  return true;
}

export interface NfcsSummary {
  key: string;
  label: string;
  variable: string | null;
  found: boolean;
  computed: boolean;
  reason: string | null;
  coding_confirmed: boolean;
  codes_seen: Record<string, number>;
  context: string | null;
}

export interface NfcsParse extends AreaFetch {
  info: {
    state_variable: string | null;
    state_codes: "postal" | "names" | "alphabetical_numeric" | null;
    state_weight: string | null;
    national_weight: string | null;
    questions: NfcsSummary[];
  };
}

const NONSUBSTANTIVE = new Set([98, 99]);

/** Computes weighted shares by state (state weight) and for the nation (national weight). */
export function summariseNfcs(table: string[][], codebook: string, wave: number, url: string | null): NfcsParse {
  const headers = (table[0] ?? []).map((h) => h.trim());
  const upper = headers.map((h) => h.toUpperCase());
  const stateIdx = upper.findIndex((h) => h === "STATEQ" || h === "STATE");
  const stateWeightIdx = upper.findIndex((h) => /^WGT_S\d*$/.test(h));
  const nationalWeightIdx = upper.findIndex((h) => /^WGT_N\d*$/.test(h));
  const info: NfcsParse["info"] = {
    state_variable: stateIdx >= 0 ? headers[stateIdx] : null,
    state_codes: null,
    state_weight: stateWeightIdx >= 0 ? headers[stateWeightIdx] : null,
    national_weight: nationalWeightIdx >= 0 ? headers[nationalWeightIdx] : null,
    questions: [],
  };
  const missingFields: string[] = [];
  if (stateIdx < 0) missingFields.push("state variable (STATEQ)");
  if (stateWeightIdx < 0) missingFields.push("state weight (wgt_s*)");
  if (nationalWeightIdx < 0) missingFields.push("national weight (wgt_n*)");
  const body = table.slice(1).filter((r) => r.some((c) => c.trim() !== ""));

  // State coding: postal codes or names as text, or numbers the codebook confirms are alphabetical.
  let stateOf: (cell: string) => string | null = () => null;
  if (stateIdx >= 0) {
    const sample = body.slice(0, 200).map((r) => (r[stateIdx] ?? "").trim());
    if (sample.every((s) => !s || /^[A-Za-z]{2}$/.test(s))) {
      info.state_codes = "postal";
      stateOf = (c) => (STATE_NAMES[c.trim().toUpperCase()] ? c.trim().toUpperCase() : null);
    } else if (sample.every((s) => !s || /^\d{1,2}$/.test(s))) {
      if (codebookConfirmsStateOrder(codebook, headers[stateIdx])) {
        info.state_codes = "alphabetical_numeric";
        stateOf = (c) => ALPHABETICAL_STATES[Number(c) - 1]?.code ?? null;
      } else missingFields.push("state code labels (codebook does not list the states in alphabetical order)");
    } else {
      info.state_codes = "names";
      const byName = new Map(ALPHABETICAL_STATES.map((s) => [s.name.toUpperCase(), s.code]));
      stateOf = (c) => byName.get(c.trim().toUpperCase()) ?? null;
    }
  }

  const rows: AreaStat[] = [];
  for (const q of NFCS_QUESTIONS) {
    const found = findVariable(codebook, q.wording, headers);
    const summary: NfcsSummary = { key: q.key, label: q.label, variable: found.variable, found: found.variable !== null, computed: false, reason: null, coding_confirmed: false, codes_seen: {}, context: found.context };
    info.questions.push(summary);
    if (!found.variable) {
      summary.reason = "wording not found in the codebook next to a respondent-file variable";
      missingFields.push(`question: ${q.label}`);
      continue;
    }
    const col = headers.indexOf(found.variable);
    summary.coding_confirmed = q.codingWords.test(codebook.slice(found.at, found.at + 1500));
    for (const r of body) {
      const v = (r[col] ?? "").trim();
      if (v) summary.codes_seen[v] = (summary.codes_seen[v] ?? 0) + 1;
    }
    const unexpected = Object.keys(summary.codes_seen).filter((c) => {
      const n = Number(c);
      return !Number.isInteger(n) || (!q.valid.includes(n) && !NONSUBSTANTIVE.has(n));
    });
    if (unexpected.length > 0) {
      summary.reason = `unexpected answer codes ${unexpected.slice(0, 8).join(", ")}`;
      continue;
    }
    if (stateIdx < 0 || stateWeightIdx < 0 || info.state_codes === null) {
      summary.reason = "no usable state variable, state codes or state weight";
      continue;
    }
    const tally = new Map<string, { yes: number; total: number; n: number }>();
    const nation = { yes: 0, total: 0, n: 0 };
    for (const r of body) {
      const code = Number((r[col] ?? "").trim());
      if (!q.valid.includes(code)) continue;
      const isYes = q.yes.includes(code);
      const state = stateOf(r[stateIdx] ?? "");
      const sw = valueWithFlag(r[stateWeightIdx]).value;
      if (state && sw !== null && sw > 0) {
        const t = tally.get(state) ?? { yes: 0, total: 0, n: 0 };
        t.n += 1;
        t.total += sw;
        if (isYes) t.yes += sw;
        tally.set(state, t);
      }
      const nw = nationalWeightIdx >= 0 ? valueWithFlag(r[nationalWeightIdx]).value : null;
      if (nw !== null && nw > 0) {
        nation.n += 1;
        nation.total += nw;
        if (isYes) nation.yes += nw;
      }
    }
    const raw = (n: number, weight: string | null) => ({ variable: found.variable, respondents: n, weight_column: weight, answers_counted: q.yes, answers_valid: q.valid, coding_confirmed: summary.coding_confirmed, state_codes: info.state_codes });
    for (const [state, t] of tally) {
      rows.push({
        geo_type: "state",
        geo_code: state,
        geo_name: ALPHABETICAL_STATES.find((s) => s.code === state)?.name ?? null,
        state_code: state,
        period: String(wave),
        series_key: q.key,
        value: t.total > 0 ? Math.round((t.yes / t.total) * 10_000) / 100 : null,
        unit: "percent of adults (weighted)",
        note: q.label,
        raw: raw(t.n, info.state_weight),
      });
    }
    if (nation.n > 0) {
      rows.push({ geo_type: "nation", geo_code: "US", geo_name: "United States", state_code: null, period: String(wave), series_key: q.key, value: Math.round((nation.yes / nation.total) * 10_000) / 100, unit: "percent of adults (weighted)", note: q.label, raw: raw(nation.n, info.national_weight) });
    }
    summary.computed = tally.size > 0;
  }
  return {
    url,
    rows,
    missingFields,
    skipped: {},
    emptyReason: rows.length === 0 ? `No NFCS ${wave} question could be computed (${info.questions.map((q) => `${q.key}: ${q.reason ?? "ok"}`).join("; ")})` : null,
    info,
  };
}

async function readBytes(urls: string[], options: RegistryFetchOptions): Promise<{ url: string; bytes: Uint8Array } | { url: null; tried: string[] }> {
  const found = await fetchFirstAvailable(urls, { timeoutMs: 180_000, ...options });
  if (found.url === null) return found;
  return { url: found.url, bytes: new Uint8Array(await found.response.arrayBuffer()) };
}

export async function fetchNfcs(wave: number, options: RegistryFetchOptions & { dataUrl?: string; codebookUrl?: string } = {}): Promise<NfcsParse> {
  const blank: NfcsParse["info"] = { state_variable: null, state_codes: null, state_weight: null, national_weight: null, questions: [] };
  let dataUrls = options.dataUrl?.trim() ? [options.dataUrl.trim()] : [];
  let codebookUrls = options.codebookUrl?.trim() ? [options.codebookUrl.trim()] : [];
  if (dataUrls.length === 0 || codebookUrls.length === 0) {
    const page = await fetchFirstAvailable([NFCS_PAGE], options);
    if (page.url !== null) {
      const links = nfcsLinks(await page.response.text(), NFCS_PAGE, wave);
      if (dataUrls.length === 0) dataUrls = links.data;
      if (codebookUrls.length === 0) codebookUrls = links.codebook;
    }
  }
  if (dataUrls.length === 0) return { url: null, rows: [], missingFields: ["state data file link"], skipped: {}, emptyReason: `No NFCS ${wave} state data file found on ${NFCS_PAGE} (set ${NFCS_DATA_URL_ENV})`, info: blank };
  if (codebookUrls.length === 0) return { url: null, rows: [], missingFields: ["codebook link"], skipped: {}, emptyReason: `No NFCS ${wave} codebook found on ${NFCS_PAGE} (set ${NFCS_CODEBOOK_URL_ENV}); variables are only taken from the codebook`, info: blank };
  const data = await readBytes(dataUrls.slice(0, 3), options);
  if (data.url === null) return { url: null, rows: [], missingFields: ["state data file"], skipped: {}, emptyReason: `NFCS ${wave} state data not found (tried ${data.tried.join(", ")})`, info: blank };
  const book = await readBytes(codebookUrls.slice(0, 3), options);
  if (book.url === null) return { url: data.url, rows: [], missingFields: ["codebook"], skipped: {}, emptyReason: `NFCS ${wave} codebook not found (tried ${book.tried.join(", ")})`, info: blank };
  let csvBytes = data.bytes;
  if (isZip(csvBytes)) {
    const files = unzipSync(csvBytes, { filter: (f) => /\.csv$/i.test(f.name) });
    const [entry] = Object.entries(files).sort(([, a], [, b]) => b.length - a.length);
    if (!entry) return { url: data.url, rows: [], missingFields: ["CSV in zip"], skipped: {}, emptyReason: "NFCS zip held no CSV respondent file", info: blank };
    csvBytes = entry[1];
  }
  const table = parseCsvTable(strFromU8(csvBytes, true));
  const text = await codebookText(book.bytes);
  const parsed = summariseNfcs(table, text, wave, data.url);
  return { ...parsed, info: { ...parsed.info, codebook_url: book.url } as NfcsParse["info"] };
}
