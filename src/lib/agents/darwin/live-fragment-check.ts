import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import {
  LIVE_FRAGMENT_REGEXES,
  feeOfSentenceTail,
  gluedSentenceSplit,
  liveFragmentName,
  liveFragmentShape,
  writeLiveRenames,
  type LiveFragmentPattern,
  type RetidyRename,
} from "@/lib/agents/knox/name-retidy";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fee names (#1443, #1436; decision 2026-10-15, "Darwin re-checks every
 * live fee against today's rules"). Publish holds a cut-off name before it goes live
 * (`publishNameHold`, `cutoff_name`), but fees that went live before that hold existed were never
 * read again: institution 5314's "or take advantage of both options to reduce your monthly fee to"
 * is live at $0, the waived price of its $7.95 monthly charge. `cutoff_name` itself is too blunt
 * for live rows (1,571 live matches, about half real fees), so this pass applies its narrow live
 * twin, `liveFragmentName`, to the live catalog name (`published_fee_records.fee_name`, not the
 * verified name: most rows where the two differ were already repaired in the catalog).
 *
 * Each Darwin verify step reads the next `LIVE_FRAGMENT_BATCH` live fees after a cursor kept on the
 * run ledger (the `darwin.live_fragment_check` event's `next_after_id`), wrapping to the start when
 * it reaches the end, so the whole live table is read again every pass. An institution-scoped run
 * reads that institution's live fees instead and leaves the cursor alone. While
 * `FRAGMENT_NAME_TAKEDOWN_LIVE` is false, or in a dry run, it only reports what it would take down.
 * When on, a matching fee is archived (rolled back with `fragment name: <pattern>`, never deleted),
 * its verified row is rejected with the same flag so publish does not bring it back, and an
 * `agent_run_events` row records the takedown. Many fragments carry the wrong amount (a minimum, a
 * waived price, a $0 online copy), so the fee comes down rather than being renamed.
 *
 * Switch-on prerequisites (#1443, after a hand sample of 100 `pronoun` rows found about 77
 * fragments, 15 real fees with a sentence glued on and 8 real names), each match takes one action
 * (`liveFragmentVerdict`):
 * - `exempt` `parenthetical`: a pronoun only inside a parenthetical ("Stop Payment (per item, if
 *   you request it)") is no fragment (`liveFragmentName` returns null; the shape is still counted).
 * - `rename`: a `pronoun` or `sentence_end` name that opens with a real fee name and has a sentence
 *   glued on ("Overdraft Fee You will be charged when ...") keeps the fee under that name
 *   (`gluedSentenceHead`), when its amount is above $0, the name has no waiver or discount wording
 *   and the category guard still accepts the name. The rename goes through Knox's live rename path
 *   (`writeLiveRenames`: a `pipeline_feedback` `name_retidied` row with the old name, checked as
 *   `darwin.live_fragment_check`, then the guarded `fee_name` update), skipped when another live fee
 *   of the bank already has that name at the same price and category.
 * - `trailing_range` comes down only when the name has waiver or discount wording or the amount is
 *   $0 (the waived price); otherwise it is `exempt` `trailing_range_priced`, reported only.
 * - Everything else is a `takedown`, as before.
 *
 * v2 (#1499, after a prod hand-check of v1): the head is read wider for `sentence_end` names and
 * generic or clause heads are refused (see `gluedSentenceHead`); a name that speaks of a minimum or
 * opening deposit is never renamed (`LIVE_FRAGMENT_OPENING_DEPOSIT`: its price is the deposit). A
 * `sentence_end` fragment that still comes down is usually a real fee whose line Knox read badly,
 * so with the switch on its takedown also writes a `pipeline_feedback` row of kind
 * `LIVE_FRAGMENT_REREAD_KIND` asking Knox to read its source line again. Knox does not act on that
 * kind yet; the row records the request and where the line is (#1499).
 */
export const LIVE_FRAGMENT_CHECK = "darwin.live_fragment_check";
/**
 * Default-off takedown switch. It turns on by PR after the dry run over the whole live table
 * (`countLiveFragmentNames`, or a full pass of step reports) has been shown to James by pattern.
 */
export const FRAGMENT_NAME_TAKEDOWN_LIVE = false;
/** Live fees read per step. A name-only regex read, so a large share; the live table takes about (live fees / 2,000) steps a pass. */
export const LIVE_FRAGMENT_BATCH = 2_000;
export const LIVE_FRAGMENT_SAMPLES = 20;
export const LIVE_FRAGMENT_REASON_PREFIX = "fragment name: ";
/** The verified row's flag when its live fee comes down. */
export const LIVE_FRAGMENT_FLAG_PREFIX = "darwin_live_fragment";
/**
 * The strategy a rename's `pipeline_feedback` row is about (#1443). v1: the parenthetical
 * exemption, the glued-sentence rename and the priced trailing range left live. v2 (#1499): the
 * wider head for `sentence_end` names (a parenthetical after the fee word, "A fee of" / "<Bank>
 * may" / a lower-case "if" or "when" as the split, a glued footnote number or "To request"
 * dropped), generic, clause and service-list heads refused, no rename of an opening-deposit line,
 * and a re-read request to Knox for each `sentence_end` fragment taken down. v3 (#1499, after a prod
 * hand-check of v2): a head split from an "if"/"when" condition is renamed only on a balance
 * condition under $100; no rename when the name states another price; "(cont.)" dropped; "2FA"
 * kept; a `sentence_end` line with no head is renamed to the fee its sentence ends on (`tail`).
 * v4 (#1499 review): no tail rename when a figure in the line equals the amount; a balance
 * condition that also counts an excess is a threshold; a dollar figure a threshold word leads into
 * is not another price; "2FA-" and "2FA:" are no footnote.
 */
export const LIVE_FRAGMENT_STRATEGY = { strategy: LIVE_FRAGMENT_CHECK, version: 4 } as const;
/** Waiver or discount wording: a name that says the price is waived or cut is a waived price, never renamed. */
export const LIVE_FRAGMENT_WAIVE_WORDING = /\b(?:waiv(?:e|ed|er|ers|es|ing)|discount(?:s|ed)?|rebates?|reduc(?:e|ed|es|tion)|avoid(?:ed|s)?|no charge)\b/i;
/**
 * v2 (#1499): a minimum or opening deposit named in the line: the price is the deposit, never a
 * fee, so the name is never renamed ("ATM5, Telephone Banking and Bill Payment" $20, 77786).
 */
export const LIVE_FRAGMENT_OPENING_DEPOSIT = /\b(?:minimum|min|opening|initial)\s+(?:(?:opening|initial)\s+)?deposits?\b|\bdeposits?\s+to\s+open\b/i;
/**
 * v2 (#1499): the `pipeline_feedback` kind a `sentence_end` takedown writes: Knox, read this fee's
 * source line again so the real fee can come back under a proper name. A request only: no Knox
 * pass reads this kind yet (darwin/AGENTS.md).
 */
export const LIVE_FRAGMENT_REREAD_KIND = "knox_reread_requested";
/**
 * v3 (#1499): the rest of a line opens with an "if" or "when" condition (either case). A head split
 * from one is renamed only when the condition is a balance condition (`LIVE_FRAGMENT_BALANCE_CONDITION`)
 * and the amount is under `LIVE_FRAGMENT_CONDITION_MAX` dollars: "Overdraft Fee when overdrawn by
 * more than" $5, "Excess Withdrawal Fee if more than" 6 and "Dormant Account Fee if inactive for
 * more than" 12 are thresholds, while 13 of 14 "X fee if the balance falls below" rows on prod were
 * the fee ($2 to $15 against thresholds of $50 to $5,000).
 */
export const LIVE_FRAGMENT_IF_CONDITION = /^\s*(?:[|:.;–—-]\s*)?(?:if|when)\b/i;
export const LIVE_FRAGMENT_BALANCE_CONDITION = /\bbalances?\b.*\b(?:below|under|less\s+than)\s*$/i;
export const LIVE_FRAGMENT_CONDITION_MAX = 100;
/** v4 (#1499): a balance condition that also counts an excess ("if more than 6 per month, balance below") is a threshold. */
/**
 * v4 (#1499): a dormancy tier after a cell break is the fee's condition, not a threshold read as
 * the amount ("Inactive Accounts Fee (cont.) | If more than 3 years dormant" $15, 44880); taken
 * only when the head ends on "fee" or "charge" and no figure in the line equals the amount.
 */
export const LIVE_FRAGMENT_TIER_CONDITION = /^\s*\|\s*if\s+(?:(?:more\s+than|over)\s+\d+\s+(?:years?|months?|days?)\s+)?(?:dormant|inactive|inactivity)\b/i;
export const LIVE_FRAGMENT_FEE_HEAD = /\b(?:fees?|charges?)$/i;
/**
 * v4 (#1499): wording that totals several charges ("users may therefore incur $45 in NSF fees",
 * "a total of"): the amount is a sum, never renamed (55708).
 */
export const LIVE_FRAGMENT_TOTAL_WORDING = /\b(?:may\s+therefore\s+incur|incur\s+\$\s?\d[\d,]*(?:\.\d{1,2})?\s+in|in\s+(?:[A-Za-z'’/-]+\s+){0,3}fees?\s+for\s+one|a\s+total\s+of)\b/i;
export const LIVE_FRAGMENT_EXCESS_CONDITION = /\b(?:more\s+than|exceeds?|exceeding|over|in\s+excess\s+of)\b/i;
/**
 * v3 (#1499): a price stated in the name with a fee word after it ("a $35 Overdraft Fee", "$45 in
 * NSF fees"); group 1 is the figure. Two of them, or one that is not the fee's amount, mean the
 * line holds another fee's price and is never renamed (133792, 55708).
 */
export const LIVE_FRAGMENT_PRICED_FEE = new RegExp(String.raw`\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s+(?:[A-Za-z'’/-]+\s+){0,3}(?:fees?|charges?)\b`, "gi");
/**
 * v3: any dollar figure; one that is not the amount blocks a rename unless the line is about a
 * balance ("below $500"). v4: a figure a threshold word leads into ("more than $5", "under $500")
 * is a threshold, not another price (`LIVE_FRAGMENT_THRESHOLD_DOLLAR`, removed before the read).
 */
export const LIVE_FRAGMENT_DOLLAR = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
export const LIVE_FRAGMENT_THRESHOLD_DOLLAR = /\b(?:(?:more|less|greater|fewer)\s+than|below|under|over|above|exceeds?|exceeding|in\s+excess\s+of|at\s+least|(?:minimum|maximum)(?:\s+of)?|up\s+to)\s+\$\s?\d[\d,]*(?:\.\d{1,2})?/gi;
const LIVE_FRAGMENT_BALANCE_WORD = /\bbalances?\b/i;
/**
 * v4 (#1499): any figure, dollar or bare ("$500", "12 months", "6 withdrawals"). On a tail line the
 * fee's own price follows the cut-off "of", so an amount equal to a figure already in the line was
 * read from that figure (a threshold, a count, another price) and the tail is never used.
 */
export const LIVE_FRAGMENT_FIGURE = /(\d[\d,]*(?:\.\d+)?)/g;
const figureValue = (text: string) => Number(text.replace(/,/g, ""));

/** v4 (#1499): true when a figure in the name equals the amount (6 = 6.00, commas ignored). */
export function liveFragmentFigureIsAmount(name: string, amount: number): boolean {
  return [...name.matchAll(LIVE_FRAGMENT_FIGURE)].some((match) => Math.abs(figureValue(match[1]) - amount) < 0.005);
}

/** v3 (#1499): true when the name states a price other than the fee's own (see `LIVE_FRAGMENT_PRICED_FEE`). */
export function liveFragmentOtherPrice(name: string, amount: number): boolean {
  const differs = (text: string) => Math.abs(figureValue(text) - amount) > 0.005;
  const priced = [...name.matchAll(LIVE_FRAGMENT_PRICED_FEE)].map((match) => match[1]);
  if (priced.length >= 2 || priced.some(differs)) return true;
  const unthresholded = name.replace(LIVE_FRAGMENT_THRESHOLD_DOLLAR, " ");
  return !LIVE_FRAGMENT_BALANCE_WORD.test(name) && [...unthresholded.matchAll(LIVE_FRAGMENT_DOLLAR)].some((match) => differs(match[1]));
}

export type LiveFragmentAction = "takedown" | "rename" | "exempt";
export type LiveFragmentExemptReason = "parenthetical" | "trailing_range_priced";
/** v3: how a rename found its name: the `head` the line opens with, or the fee its sentence ends on (`tail`). */
export type LiveFragmentRenameVia = "head" | "tail";
/**
 * Why a fee comes down: its name is a `fragment`, or it would have been renamed to a name another
 * live fee of the bank already has at the same price and category (`rename_duplicate`: that fee
 * is already live, so this copy comes down).
 */
export type LiveFragmentTakedownReason = "fragment" | "rename_duplicate";

export interface LiveFragmentRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key?: string | null;
}

export interface LiveFragmentSample {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  pattern: LiveFragmentPattern;
  action: LiveFragmentAction;
  /** `rename`: the fee name the fragment opens with (or, `tail`, ends on). */
  renameTo?: string;
  renameVia?: LiveFragmentRenameVia;
  /** `exempt`: why the fee stays live under its name. */
  exemptReason?: LiveFragmentExemptReason;
  /** `takedown`: why the fee comes down. */
  takedownReason?: LiveFragmentTakedownReason;
  /** v2: a `sentence_end` fragment taken down asks Knox to re-read its source line. */
  rereadRequest?: boolean;
}

type PatternCounts = Record<LiveFragmentPattern, number>;
const emptyPatterns = (): PatternCounts => ({ plus: 0, trailing_range: 0, sentence_end: 0, pronoun: 0 });
const emptyByAction = (): Record<LiveFragmentAction, PatternCounts> => ({ takedown: emptyPatterns(), rename: emptyPatterns(), exempt: emptyPatterns() });
const emptySamples = (): Record<LiveFragmentAction, LiveFragmentSample[]> => ({ takedown: [], rename: [], exempt: [] });

export interface LiveFragmentFindings {
  checked: number;
  /** Names carrying a live fragment shape, whatever the action. */
  matched: number;
  /** Matches that would come down (`takedown`). */
  wouldTakeDown: number;
  /** Matches that would keep their fee under a cleaned name (`rename`). */
  wouldRename: number;
  /** v3: the renames by how they found their name (`head` or `tail`). */
  wouldRenameByVia: Record<LiveFragmentRenameVia, number>;
  /** Matches that stay live under their name (`exempt`). */
  exempt: number;
  /** v2: takedowns that would ask Knox to re-read their source line (`sentence_end` fragments). */
  wouldRequestReread: number;
  exemptByReason: Record<LiveFragmentExemptReason, number>;
  takedownByReason: Record<LiveFragmentTakedownReason, number>;
  byPattern: PatternCounts;
  byAction: Record<LiveFragmentAction, PatternCounts>;
  /** Up to `LIVE_FRAGMENT_SAMPLES` of each action. */
  samplesByAction: Record<LiveFragmentAction, LiveFragmentSample[]>;
  /** Up to `LIVE_FRAGMENT_SAMPLES` of the `rename_duplicate` takedowns. */
  renameDuplicateSamples: LiveFragmentSample[];
  /** Up to `LIVE_FRAGMENT_SAMPLES` of every match, in id order. */
  samples: LiveFragmentSample[];
}

export interface LiveFragmentResult extends LiveFragmentFindings {
  live: boolean;
  dryRun: boolean;
  /** The cursor this step started after (0 at the start of a pass; null when institution-scoped). */
  afterId: number | null;
  /** Where the next step starts; 0 when this step reached the end of the live table. */
  nextAfterId: number | null;
  /** Live fees archived in this step (switch on, not a dry run). */
  takenDown: number[];
  /** Live fees renamed in this step (switch on, not a dry run). */
  renamed: number[];
  /** Live fees taken down in this step whose re-read request reached `pipeline_feedback`. */
  rereadRequested: number[];
  /** The read of live names outside the batch failed: duplicates are checked within the batch only and nothing is renamed. */
  duplicateCheckFailed: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure (#1443): what the re-check does with one live name, or null when the name carries no live
 * fragment shape. See the module note for the rules.
 */
export function liveFragmentVerdict(
  name: string | null | undefined,
  amount: number | null,
  canonicalFeeKey: string | null = null,
): { pattern: LiveFragmentPattern; action: LiveFragmentAction; renameTo?: string; renameVia?: LiveFragmentRenameVia; exemptReason?: LiveFragmentExemptReason } | null {
  const pattern = liveFragmentShape(name);
  if (!pattern) return null;
  if (!liveFragmentName(name)) return { pattern, action: "exempt", exemptReason: "parenthetical" };
  const current = (name ?? "").replace(/\s+/g, " ").trim();
  const waived = LIVE_FRAGMENT_WAIVE_WORDING.test(current);
  if (pattern === "trailing_range") {
    return waived || amount === 0 ? { pattern, action: "takedown" } : { pattern, action: "exempt", exemptReason: "trailing_range_priced" };
  }
  if ((pattern === "pronoun" || pattern === "sentence_end") && amount != null && amount > 0 && !waived
      && !LIVE_FRAGMENT_OPENING_DEPOSIT.test(current) && !LIVE_FRAGMENT_TOTAL_WORDING.test(current) && !liveFragmentOtherPrice(current, amount)) {
    const split = gluedSentenceSplit(current);
    let candidate: { renameTo: string; renameVia: LiveFragmentRenameVia } | null = null;
    if (split) {
      // v3: a head split from an "if"/"when" condition only on a balance condition under $100.
      // v4: or a dormancy tier after a cell break; never when a figure in the line is the amount.
      const balanceOk = LIVE_FRAGMENT_BALANCE_CONDITION.test(split.rest) && !LIVE_FRAGMENT_EXCESS_CONDITION.test(split.rest) && amount < LIVE_FRAGMENT_CONDITION_MAX;
      const tierOk = LIVE_FRAGMENT_TIER_CONDITION.test(split.rest) && LIVE_FRAGMENT_FEE_HEAD.test(split.head);
      const conditionOk = !LIVE_FRAGMENT_IF_CONDITION.test(split.rest) || ((balanceOk || tierOk) && !liveFragmentFigureIsAmount(current, amount));
      if (conditionOk) candidate = { renameTo: split.head, renameVia: "head" };
    } else if (pattern === "sentence_end" && !liveFragmentFigureIsAmount(current, amount)) {
      const tail = feeOfSentenceTail(current);
      if (tail) candidate = { renameTo: tail, renameVia: "tail" };
    }
    if (candidate && liveFragmentName(candidate.renameTo) == null) {
      // Knox's rename bar: a name the category guard accepted must still be accepted once cleaned.
      const guardOk = canonicalFeeKey == null || !checkFeeCategory(canonicalFeeKey, current).ok || checkFeeCategory(canonicalFeeKey, candidate.renameTo).ok;
      if (guardOk) return { pattern, action: "rename", ...candidate };
    }
  }
  return { pattern, action: "takedown" };
}

/**
 * The key a rename collides on: bank, category, price and the name with its inner whitespace
 * collapsed, case-free. The count SQL compares the same four.
 */
export function liveNameKey(institutionId: number | string, canonicalFeeKey: string | null | undefined, amount: number | string | null, name: string): string {
  const price = num(amount);
  return `${Number(institutionId)}|${canonicalFeeKey ?? ""}|${price == null ? "" : price.toFixed(2)}|${name.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/**
 * Pure: the live rows whose catalog name is a fragment, counted by pattern and action, with every
 * match kept. `liveNames` holds the keys (`liveNameKey`) of live fees outside `rows`; the rows'
 * own names are added. A rename onto a key already live, or onto one an earlier row (by id) of
 * the same read takes, comes down instead (`rename_duplicate`).
 */
export function findLiveFragments(rows: LiveFragmentRow[], liveNames: ReadonlySet<string> = new Set()): LiveFragmentFindings & { matches: LiveFragmentSample[] } {
  const byPattern = emptyPatterns();
  const byAction = emptyByAction();
  const samplesByAction = emptySamples();
  const exemptByReason: Record<LiveFragmentExemptReason, number> = { parenthetical: 0, trailing_range_priced: 0 };
  const takedownByReason: Record<LiveFragmentTakedownReason, number> = { fragment: 0, rename_duplicate: 0 };
  const renameDuplicateSamples: LiveFragmentSample[] = [];
  const taken = new Set(liveNames);
  for (const row of rows) if (row.fee_name) taken.add(liveNameKey(row.institution_id, row.canonical_fee_key, row.amount, row.fee_name));
  const matches: LiveFragmentSample[] = [];
  const ordered = [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id));
  for (const row of ordered) {
    const amount = num(row.amount);
    const canonicalFeeKey = row.canonical_fee_key ?? null;
    const verdict = liveFragmentVerdict(row.fee_name, amount, canonicalFeeKey);
    if (!verdict) continue;
    let { action } = verdict;
    let takedownReason: LiveFragmentTakedownReason | undefined = action === "takedown" ? "fragment" : undefined;
    if (action === "rename" && verdict.renameTo) {
      const key = liveNameKey(row.institution_id, canonicalFeeKey, amount, verdict.renameTo);
      if (taken.has(key)) {
        action = "takedown";
        takedownReason = "rename_duplicate";
      } else {
        taken.add(key);
      }
    }
    byPattern[verdict.pattern] += 1;
    byAction[action][verdict.pattern] += 1;
    if (verdict.exemptReason) exemptByReason[verdict.exemptReason] += 1;
    if (takedownReason) takedownByReason[takedownReason] += 1;
    const rereadRequest = takedownReason === "fragment" && verdict.pattern === "sentence_end";
    const sample: LiveFragmentSample = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount,
      canonicalFeeKey,
      pattern: verdict.pattern,
      action,
      ...(verdict.renameTo ? { renameTo: verdict.renameTo } : {}),
      ...(verdict.renameVia ? { renameVia: verdict.renameVia } : {}),
      ...(verdict.exemptReason ? { exemptReason: verdict.exemptReason } : {}),
      ...(takedownReason ? { takedownReason } : {}),
      ...(rereadRequest ? { rereadRequest } : {}),
    };
    matches.push(sample);
    if (samplesByAction[action].length < LIVE_FRAGMENT_SAMPLES) samplesByAction[action].push(sample);
    if (takedownReason === "rename_duplicate" && renameDuplicateSamples.length < LIVE_FRAGMENT_SAMPLES) renameDuplicateSamples.push(sample);
  }
  const count = (action: LiveFragmentAction) => matches.filter((fee) => fee.action === action).length;
  return {
    checked: rows.length,
    matched: matches.length,
    wouldTakeDown: count("takedown"),
    wouldRename: count("rename"),
    wouldRenameByVia: {
      head: matches.filter((fee) => fee.action === "rename" && fee.renameVia === "head").length,
      tail: matches.filter((fee) => fee.action === "rename" && fee.renameVia === "tail").length,
    },
    exempt: count("exempt"),
    wouldRequestReread: matches.filter((fee) => fee.rereadRequest).length,
    exemptByReason,
    takedownByReason,
    byPattern,
    byAction,
    samplesByAction,
    renameDuplicateSamples,
    samples: matches.slice(0, LIVE_FRAGMENT_SAMPLES),
    matches,
  };
}

/** The findings without every match (the ledger keeps samples only). */
function withoutMatches(found: LiveFragmentFindings & { matches: LiveFragmentSample[] }): LiveFragmentFindings {
  const { matches: _matches, ...findings } = found;
  void _matches;
  return findings;
}

/**
 * The live names outside a read that the read's rename candidates could collide with: every live
 * fee (not rolled back or quarantined) of the candidates' banks whose collapsed, case-free name is
 * one of the new names. Null when the read fails.
 */
async function liveNamesFor(db: SqlTag, rows: LiveFragmentRow[]): Promise<Set<string> | null> {
  const candidates = findLiveFragments(rows).matches.filter((fee) => fee.action === "rename" || fee.takedownReason === "rename_duplicate");
  if (candidates.length === 0) return new Set();
  try {
    const existing = await inSavepoint(db, (scope) => scope<{ institution_id: number | string; canonical_fee_key: string | null; amount: number | string | null; fee_name: string }[]>`
      SELECT fp.institution_id, fp.canonical_fee_key, fp.amount, fp.fee_name
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.institution_id = ANY(${[...new Set(candidates.map((fee) => fee.institutionId))]}::bigint[])
         AND lower(btrim(regexp_replace(fp.fee_name, '\\s+', ' ', 'g'))) = ANY(${[...new Set(candidates.map((fee) => (fee.renameTo ?? "").toLowerCase()))]}::text[])
    `);
    return new Set(existing.map((row) => liveNameKey(row.institution_id, row.canonical_fee_key, row.amount, row.fee_name)));
  } catch (error) {
    console.warn("[darwin] live fragment duplicate-name read failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The reason a live fee comes down with, in `rolled_back_reason`. */
export function liveFragmentReason(pattern: LiveFragmentPattern, reason: LiveFragmentTakedownReason = "fragment"): string {
  return `${LIVE_FRAGMENT_REASON_PREFIX}${pattern}${reason === "rename_duplicate" ? " (rename_duplicate)" : ""}`;
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${LIVE_FRAGMENT_CHECK}
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read
 * reports nothing checked, and a failed takedown or rename leaves the fees as they were.
 */
export async function recheckLiveFragmentNames(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number },
): Promise<LiveFragmentResult> {
  const live = options.live ?? FRAGMENT_NAME_TAKEDOWN_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? LIVE_FRAGMENT_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: LiveFragmentResult = {
    live,
    dryRun: options.dryRun,
    ...withoutMatches(findLiveFragments([])),
    afterId: null,
    nextAfterId: null,
    takenDown: [],
    renamed: [],
    rereadRequested: [],
    duplicateCheckFailed: false,
  };
  let rows: LiveFragmentRow[];
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    rows = await inSavepoint(db, (scope) => scope<LiveFragmentRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.fee_published_id > ${afterId}
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
       ORDER BY fp.fee_published_id
       LIMIT ${limit}::int
    `);
    if (!scoped) {
      result.afterId = afterId;
      // A short batch reached the end of the live table: the next step starts the pass again.
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
  } catch (error) {
    console.warn("[darwin] live fragment check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  // Rename collisions with live fees outside this batch (the rows' own names are checked in findLiveFragments).
  const liveNames = await liveNamesFor(db, rows);
  result.duplicateCheckFailed = liveNames == null;
  const all = findLiveFragments(rows, liveNames ?? new Set());
  const { matches } = all;
  Object.assign(result, withoutMatches(all));
  const takedowns = matches.filter((fee) => fee.action === "takedown");
  const renameCandidates = matches.filter((fee) => fee.action === "rename");

  if (live && !options.dryRun && takedowns.length > 0) {
    try {
      result.takenDown = await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${`darwin-live-fragment-${options.runId}`},
                 rolled_back_reason = v.reason
            FROM unnest(${takedowns.map((fee) => fee.feePublishedId)}::bigint[], ${takedowns.map((fee) => liveFragmentReason(fee.pattern, fee.takedownReason))}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const verified = takedowns.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'rejected',
                   outlier_flags = CASE
                     WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                     ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
                   END
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${verified.map((fee) => `${LIVE_FRAGMENT_FLAG_PREFIX}:${fee.pattern}`)}::text[])
                   AS v(fee_verified_id, flag)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.review_status IN ('verified', 'approved')
          `;
        }
        return takedowns.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] live fragment takedown failed", error instanceof Error ? error.message : error);
      result.takenDown = [];
    }
    if (result.takenDown.length > 0) {
      const down = new Set(result.takenDown);
      const archived = takedowns.filter((fee) => down.has(fee.feePublishedId));
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.live_fragment_name_taken_down', 'completed',
            ${`Archived ${result.takenDown.length} live fee(s) whose name is a sentence fragment`},
            ${JSON.stringify({
              batch_id: `darwin-live-fragment-${options.runId}`,
              taken_down: result.takenDown.length,
              by_pattern: archived.reduce<Record<string, number>>((counts, fee) => {
                counts[fee.pattern] = (counts[fee.pattern] ?? 0) + 1;
                return counts;
              }, {}),
              samples: archived.slice(0, LIVE_FRAGMENT_SAMPLES).map(sampleDetail),
            })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] live fragment takedown event failed", error instanceof Error ? error.message : error);
      }
    }
  }

  if (live && !options.dryRun && renameCandidates.length > 0 && !result.duplicateCheckFailed) {
    const renames: RetidyRename[] = renameCandidates.map((fee) => ({
      feePublishedId: fee.feePublishedId,
      institutionId: fee.institutionId,
      sourceDocumentId: null,
      canonicalFeeKey: fee.canonicalFeeKey ?? "",
      amount: fee.amount,
      oldName: fee.feeName,
      newName: fee.renameTo as string,
    }));
    try {
      // Knox's live rename path: the old name logged in pipeline_feedback, then the guarded update.
      await inSavepoint(db, (scope) => writeLiveRenames(scope, renames, {
        strategy: LIVE_FRAGMENT_STRATEGY.strategy,
        version: LIVE_FRAGMENT_STRATEGY.version,
        reportedBy: "darwin",
        runId: options.runId,
      }));
      result.renamed = renames.map((rename) => rename.feePublishedId);
    } catch (error) {
      console.error("[darwin] live fragment rename failed", error instanceof Error ? error.message : error);
      result.renamed = [];
    }
    if (result.renamed.length > 0) {
      // Its own try, as the takedown's: a failed event never hides renames already written.
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.live_fragment_name_renamed', 'completed',
            ${`Renamed ${renames.length} live fee(s) whose name had a sentence glued on; old names kept in pipeline_feedback`},
            ${JSON.stringify({
              version: LIVE_FRAGMENT_STRATEGY.version,
              renamed: renames.length,
              samples: renames.slice(0, LIVE_FRAGMENT_SAMPLES).map((rename) => ({
                fee_published_id: rename.feePublishedId,
                institution_id: rename.institutionId,
                old_name: rename.oldName,
                new_name: rename.newName,
                amount: rename.amount,
              })),
            })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] live fragment rename event failed", error instanceof Error ? error.message : error);
      }
    }
  }
  if (result.takenDown.length > 0) {
    // v2 (#1499): each `sentence_end` fragment taken down asks Knox to re-read its line.
    const down = new Set(result.takenDown);
    result.rereadRequested = await requestKnoxRereads(db, takedowns.filter((fee) => fee.rereadRequest && down.has(fee.feePublishedId)), options.runId);
  }
  if (result.takenDown.length > 0 || result.renamed.length > 0) invalidatePublicReadCache();

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LIVE_FRAGMENT_CHECK}, 'completed',
          ${`Read ${result.checked} live fee name(s): ${result.matched} fragment shape(s), ${result.wouldTakeDown} takedown, ${result.wouldRename} rename, ${result.exempt} exempt; ${live ? `${result.takenDown.length} archived, ${result.renamed.length} renamed, ${result.rereadRequested.length} re-read request(s) to Knox` : "switch off, nothing written"}`},
          ${JSON.stringify(liveFragmentDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] live fragment check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * v2 (#1499): one `pipeline_feedback` row per `sentence_end` fragment taken down, asking Knox to
 * read its source line again (kind `LIVE_FRAGMENT_REREAD_KIND`, about Knox's extract, reported by
 * Darwin, one row per live fee). The raw row and its document come from the verified row the
 * live fee came from. Returns the fees written; a failure writes none and never undoes the takedown.
 */
async function requestKnoxRereads(db: SqlTag, fees: LiveFragmentSample[], runId: number): Promise<number[]> {
  if (fees.length === 0) return [];
  try {
    return await inSavepoint(db, async (scope) => {
      const verifiedIds = fees.map((fee) => fee.feeVerifiedId).filter((id): id is number => id != null);
      const lineage = verifiedIds.length === 0 ? [] : await scope<{ fee_verified_id: number | string; fee_raw_id: number | string | null; source_document_id: number | string | null }[]>`
        SELECT fv.fee_verified_id, fv.fee_raw_id, fr.source_document_id
          FROM verified_fee_observations fv
          LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         WHERE fv.fee_verified_id = ANY(${verifiedIds}::bigint[])
      `;
      const byVerified = new Map(lineage.map((row) => [Number(row.fee_verified_id), row]));
      const rows: FeedbackRow[] = fees.map((fee) => {
        const line = fee.feeVerifiedId == null ? undefined : byVerified.get(fee.feeVerifiedId);
        return {
          aboutStage: "extract",
          signal: "wrong",
          kind: LIVE_FRAGMENT_REREAD_KIND,
          reportedBy: "darwin",
          checkName: LIVE_FRAGMENT_CHECK,
          institutionId: fee.institutionId,
          sourceDocumentId: num(line?.source_document_id),
          feeRawId: num(line?.fee_raw_id),
          feeVerifiedId: fee.feeVerifiedId,
          feePublishedId: fee.feePublishedId,
          canonicalFeeKey: fee.canonicalFeeKey,
          amount: fee.amount,
          evidence: {
            request: "reread_source_line",
            fee_name: fee.feeName,
            reason: liveFragmentReason(fee.pattern, fee.takedownReason),
            strategy_version: LIVE_FRAGMENT_STRATEGY.version,
            consumer: "none yet: no Knox pass reads this kind (#1499)",
          },
          runId,
          dedupeKey: `${LIVE_FRAGMENT_CHECK}:reread:pub:${fee.feePublishedId}`,
        };
      });
      await recordFeedback(scope, rows);
      return fees.map((fee) => fee.feePublishedId);
    });
  } catch (error) {
    console.error("[darwin] live fragment re-read request failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function sampleDetail(fee: LiveFragmentSample) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    pattern: fee.pattern,
    action: fee.action,
    ...(fee.renameTo ? { rename_to: fee.renameTo } : {}),
    ...(fee.renameVia ? { rename_via: fee.renameVia } : {}),
    ...(fee.exemptReason ? { exempt_reason: fee.exemptReason } : {}),
    ...(fee.takedownReason ? { takedown_reason: fee.takedownReason } : {}),
    ...(fee.rereadRequest ? { reread_request: true } : {}),
  };
}

/** The findings as ledger detail, split by action (takedown / rename / exempt) with samples of each. */
export function liveFragmentFindingsDetail(found: LiveFragmentFindings) {
  return {
    checked: found.checked,
    matched: found.matched,
    would_take_down: found.wouldTakeDown,
    would_rename: found.wouldRename,
    would_rename_by_via: found.wouldRenameByVia,
    exempt: found.exempt,
    would_request_reread: found.wouldRequestReread,
    exempt_by_reason: found.exemptByReason,
    takedown_by_reason: found.takedownByReason,
    by_pattern: found.byPattern,
    by_action: found.byAction,
    samples_by_action: {
      takedown: found.samplesByAction.takedown.map(sampleDetail),
      rename: found.samplesByAction.rename.map(sampleDetail),
      exempt: found.samplesByAction.exempt.map(sampleDetail),
    },
    samples_rename_duplicate: found.renameDuplicateSamples.map(sampleDetail),
  };
}

/** The step detail (and ledger event detail) for one step's share. */
export function liveFragmentDetail(result: LiveFragmentResult) {
  return {
    check: LIVE_FRAGMENT_CHECK,
    version: LIVE_FRAGMENT_STRATEGY.version,
    takedown_live: result.live,
    dry_run: result.dryRun,
    batch: LIVE_FRAGMENT_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...liveFragmentFindingsDetail(result),
    taken_down: result.takenDown.length,
    renamed: result.renamed.length,
    reread_requested: result.rereadRequested.length,
    duplicate_check_failed: result.duplicateCheckFailed,
  };
}

/** A JS regex as a Postgres ARE literal: `\b` is a backspace there, `\y` the word boundary. */
function postgresPattern(re: RegExp): string {
  return re.source.replace(/\\b/g, "\\y").replace(/'/g, "''");
}

/**
 * The same count as one read-only SQL statement, for someone with prod access (#1443), by action
 * (takedown / rename / exempt), reason and pattern. Built from `LIVE_FRAGMENT_REGEXES` and
 * `LIVE_FRAGMENT_WAIVE_WORDING`, so it stays in step with `liveFragmentVerdict` and
 * `findLiveFragments`: a rename onto a name another live fee of the bank has at the same price and
 * category, or onto one an earlier fee (by id) is renamed to, counts as a `rename_duplicate`
 * takedown. Two known differences: Postgres's word boundary reads non-ASCII letters as word
 * characters, which JS does not, so a name with accented letters next to a matched word can count
 * differently; and the SQL does not run the category guard on a rename (a cleaned name the guard
 * would refuse comes down in the step but counts as a rename here; the step's ledger is the exact
 * count). A third: the SQL does not re-check that the cleaned name is itself no fragment
 * (`liveFragmentName(head)`), so a head that still reads as one counts as a rename here and comes
 * down in the step. Its totals can also differ from the sum of the step's per-batch ledger totals:
 * the step finds a duplicate rename only inside its batch of fees or against names already live,
 * so two renames onto the same name in different batches are both renames in the ledger but one
 * rename and one `rename_duplicate` here. The trailing range's optional leading separators
 * (`[\s\-–—|:,]*`) never change whether it matches, so the SQL leaves them out. v3 (#1499): the
 * "if"/"when" gate reads the rest of the line after the head, the other-price gate counts the
 * priced figures with `regexp_matches`, and a `sentence_end` line with no head that ends on a fee
 * (`fee_of_sentence_tail`) counts as reason `rename_tail` (action `rename`); the `liveFragmentName`
 * re-check of the cleaned name is skipped for the tail too. v2 (#1499): the
 * glued footnote number or "To request" is dropped (`glued_lead_strip`) before the head is read,
 * the new head bars ride in `glued_head_bars` and the opening-deposit wording blocks a rename, all
 * from the same regexes; the re-read requests to Knox are the `takedown` / `fragment` /
 * `sentence_end` row (the step's `would_request_reread`).
 */
export function liveFragmentCountSql(): string {
  const re = LIVE_FRAGMENT_REGEXES;
  const waive = postgresPattern(LIVE_FRAGMENT_WAIVE_WORDING);
  const deposit = postgresPattern(LIVE_FRAGMENT_OPENING_DEPOSIT);
  const barsOn = (column: string) => re.glued_head_bars.map((bar) => `${column} !~${bar.flags.includes("i") ? "*" : ""} '${postgresPattern(bar)}'`).join(" AND ");
  const priced = postgresPattern(LIVE_FRAGMENT_PRICED_FEE);
  const dollar = postgresPattern(LIVE_FRAGMENT_DOLLAR);
  return `WITH live AS (
  SELECT fee_published_id, institution_id, canonical_fee_key, amount,
         btrim(regexp_replace(COALESCE(fee_name, ''), '\\s+', ' ', 'g')) AS name
    FROM published_fee_records
   WHERE rolled_back_at IS NULL AND quarantined_at IS NULL
), tagged AS (
  SELECT *, CASE
    WHEN name ~ '${postgresPattern(re.plus)}' AND regexp_replace(name, '^\\++\\s*', '') !~* '${postgresPattern(re.plus_fee_noun)}' THEN 'plus'
    WHEN name ~* '${postgresPattern(new RegExp(re.trailing_range.source.replace(/^\[[^\]]*\]\*/, "")))}' THEN 'trailing_range'
    WHEN name ~* '${postgresPattern(re.sentence_end)}' OR name ~ '${postgresPattern(re.sentence_end_article)}' THEN 'sentence_end'
    WHEN name ~* '${postgresPattern(re.pronoun)}' THEN 'pronoun'
  END AS pattern,
  btrim(regexp_replace(regexp_replace(name, '${postgresPattern(re.parenthetical)}', ' ', 'g'), '\\s+', ' ', 'g')) AS outside,
  regexp_replace(btrim(regexp_replace(name, '${postgresPattern(re.glued_cont_mark)}', '', 'gi')), '${postgresPattern(re.glued_lead_strip)}', '') AS readable,
  btrim((regexp_match(name, '${postgresPattern(re.fee_of_sentence_tail)}', 'i'))[1]) AS tail_raw,
  (SELECT count(*) FROM regexp_matches(name, '${priced}', 'gi')) AS priced_count,
  EXISTS (SELECT 1 FROM regexp_matches(name, '${priced}', 'gi') m WHERE replace(m[1], ',', '')::numeric <> amount)
    OR (name !~* '\\ybalances?\\y' AND EXISTS (SELECT 1 FROM regexp_matches(regexp_replace(name, '${postgresPattern(LIVE_FRAGMENT_THRESHOLD_DOLLAR)}', ' ', 'gi'), '${dollar}', 'g') m WHERE replace(m[1], ',', '')::numeric <> amount)) AS other_figure,
  EXISTS (SELECT 1 FROM regexp_matches(name, '${postgresPattern(LIVE_FRAGMENT_FIGURE)}', 'g') m WHERE abs(replace(m[1], ',', '')::numeric - amount) < 0.005) AS figure_is_amount
  FROM live
), matched AS (
  SELECT *, substring(readable from '${postgresPattern(re.glued_sentence)}') AS head_plain,
         CASE WHEN readable ~ '^[a-z]' THEN upper(left(readable, 1)) || substr(readable, 2) END AS readable_cap,
         btrim(regexp_replace(tail_raw, '${postgresPattern(re.tail_qualifiers)}', '', 'i')) AS tail_phrase
    FROM tagged
   WHERE pattern IS NOT NULL
), capped AS (
  SELECT *, substring(readable_cap from '${postgresPattern(re.glued_sentence)}') AS head_cap FROM matched
), split AS (
  SELECT *, CASE
    WHEN head_plain IS NOT NULL THEN head_plain
    WHEN head_cap IS NOT NULL AND substr(readable_cap, length(head_cap) + 1) ~ '${postgresPattern(re.glued_lower_condition)}' THEN head_cap
  END AS head
    FROM capped
), candidate AS (
  SELECT *,
         COALESCE(head IS NOT NULL AND ${barsOn("head")}, false) AS head_ok,
         substr(COALESCE(CASE WHEN head_plain IS NULL THEN readable_cap END, readable), length(head) + 1) AS rest,
         COALESCE(tail_phrase <> '' AND tail_raw !~* '${postgresPattern(re.tail_person)}' AND tail_phrase !~* '${postgresPattern(re.tail_generic_only)}' AND ${barsOn("tail_phrase")}, false) AS tail_ok,
         upper(left(tail_phrase, 1)) || substr(tail_phrase, 2) AS tail,
         COALESCE(amount, 0) > 0 AND name !~* '${waive}' AND name !~* '${deposit}' AND name !~* '${postgresPattern(LIVE_FRAGMENT_TOTAL_WORDING)}'
           AND priced_count < 2 AND NOT COALESCE(other_figure, false) AS renamable
    FROM split
), verdict AS (
  SELECT fee_published_id, institution_id, canonical_fee_key, amount, name, pattern, CASE
    WHEN pattern = 'pronoun' AND outside !~* '${postgresPattern(re.pronoun)}' THEN 'parenthetical'
    WHEN pattern = 'trailing_range' THEN CASE WHEN name ~* '${waive}' OR COALESCE(amount, -1) = 0 THEN 'fragment' ELSE 'trailing_range_priced' END
    WHEN pattern IN ('pronoun', 'sentence_end') AND renamable AND head_ok
         AND (rest !~* '${postgresPattern(LIVE_FRAGMENT_IF_CONDITION)}'
              OR (((rest ~* '${postgresPattern(LIVE_FRAGMENT_BALANCE_CONDITION)}' AND rest !~* '${postgresPattern(LIVE_FRAGMENT_EXCESS_CONDITION)}' AND amount < ${LIVE_FRAGMENT_CONDITION_MAX})
                   OR (rest ~* '${postgresPattern(LIVE_FRAGMENT_TIER_CONDITION)}' AND head ~* '${postgresPattern(LIVE_FRAGMENT_FEE_HEAD)}'))
                  AND NOT COALESCE(figure_is_amount, false))) THEN 'rename'
    WHEN pattern = 'sentence_end' AND renamable AND NOT head_ok AND tail_ok AND NOT COALESCE(figure_is_amount, false) THEN 'rename_tail'
    ELSE 'fragment'
  END AS first_reason,
  CASE WHEN head_ok THEN head WHEN tail_ok THEN tail END AS rename_to
  FROM candidate
), ranked AS (
  SELECT v.*,
         row_number() OVER (PARTITION BY v.first_reason IN ('rename', 'rename_tail'), v.institution_id, v.canonical_fee_key, v.amount, lower(v.rename_to) ORDER BY v.fee_published_id) AS rename_rank
    FROM verdict v
), acted AS (
  SELECT r.fee_published_id, r.name, r.amount, r.rename_to, r.pattern, CASE
    WHEN r.first_reason IN ('rename', 'rename_tail') AND (r.rename_rank > 1 OR EXISTS (
      SELECT 1 FROM live l
       WHERE l.institution_id = r.institution_id
         AND l.canonical_fee_key IS NOT DISTINCT FROM r.canonical_fee_key
         AND l.amount = r.amount
         AND lower(l.name) = lower(r.rename_to)
    )) THEN 'rename_duplicate'
    ELSE r.first_reason
  END AS reason
  FROM ranked r
), counted AS (
  SELECT pattern, reason, CASE
    WHEN reason IN ('fragment', 'rename_duplicate') THEN 'takedown'
    WHEN reason IN ('rename', 'rename_tail') THEN 'rename'
    ELSE 'exempt'
  END AS action
  FROM acted
)
SELECT COALESCE(action, 'all actions') AS action, COALESCE(reason, 'all reasons') AS reason, COALESCE(pattern, 'all patterns') AS pattern, count(*) AS fees
  FROM counted
 GROUP BY GROUPING SETS ((action, reason, pattern), (action, reason), (action), ())
 ORDER BY 1, 2, 3;`;
}

/**
 * The dry-run count over the whole live table in one read (every live fee's id and name; no
 * cursor, nothing written). For the count James sees before the switch goes on, when a pass of
 * step batches would take many steps. Run it with the Darwin verify step's `fragment_full_count`
 * param.
 */
export async function countLiveFragmentNames(db: SqlTag): Promise<LiveFragmentFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<LiveFragmentRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
       ORDER BY fp.fee_published_id
    `);
    return withoutMatches(findLiveFragments(rows));
  } catch (error) {
    console.warn("[darwin] live fragment full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}
