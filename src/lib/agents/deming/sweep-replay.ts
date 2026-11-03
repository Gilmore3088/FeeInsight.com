import { BANDED_ZERO_CATEGORIES } from "@/lib/banded-zero";
import { BANDED_ZERO_TAKEDOWN_LIVE, findBandedZeros } from "@/lib/agents/darwin/banded-zero-check";
import { findRateFloors, RATE_FLOOR_TAKEDOWN_LIVE } from "@/lib/agents/darwin/rate-floor-check";
import { findLateChargeBounds, LATE_CHARGE_BOUND_TAKEDOWN_LIVE } from "@/lib/agents/darwin/late-charge-bound-check";
import { findNoFeeSentences, NO_FEE_SENTENCE_TAKEDOWN_LIVE } from "@/lib/agents/darwin/no-fee-sentence-check";
import { findZeroWaiverRows, ZERO_WAIVER_ROW_TAKEDOWN_LIVE } from "@/lib/agents/darwin/zero-waiver-row-check";
import { findFreeListItems, FREE_LIST_ITEM_PREFILTER, FREE_LIST_ITEM_TAKEDOWN_LIVE } from "@/lib/agents/darwin/free-list-item-check";
import { findNotAccountFeeLines, NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE } from "@/lib/agents/darwin/not-account-fee-line-check";
import { CREDIT_CARD_SECTION_KEYS, CREDIT_CARD_SECTION_TAKEDOWN_LIVE, findCreditCardSectionFees } from "@/lib/agents/darwin/credit-card-section-check";
import { findLoanPaymentExamples, LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE } from "@/lib/agents/darwin/loan-payment-example-check";
import { canadianDocument, CANADIAN_DOCUMENT_TAKEDOWN_LIVE } from "@/lib/agents/darwin/canadian-document-check";
import {
  BROKERAGE_DOCUMENT_TAKEDOWN_LIVE,
  CARD_PROGRAM_TAKEDOWN_LIVE,
  CREDIT_TERMS_TAKEDOWN_LIVE,
  NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE,
  nonDepositTakedownReason,
  OPENING_DOCUMENT_TAKEDOWN_LIVE,
} from "@/lib/agents/darwin/non-deposit-document-check";
import { OPENING_SCAN_CHARS } from "@/lib/non-deposit-document";
import { findLoanSectionFees, LOAN_SECTION_TAKEDOWN_LIVE } from "@/lib/agents/darwin/loan-section-check";
import { CARD_PROGRAM_SECTION_TAKEDOWN_LIVE, findCardProgramSectionFees } from "@/lib/agents/darwin/card-program-section-check";
import {
  COMPARATOR_FRAGMENT_REREAD_LIVE,
  findLiveFragments,
  FRAGMENT_NAME_TAKEDOWN_LIVE,
  QUALIFIED_FRAGMENT_TAKEDOWN_LIVE,
} from "@/lib/agents/darwin/live-fragment-check";
import { findSameLineReads, SAME_LINE_READ_TAKEDOWN_LIVE } from "@/lib/agents/darwin/same-line-read-check";
import { findLineConflicts, LINE_CONFLICT_OWN_UNIT_LIVE, LINE_CONFLICT_TAKEDOWN_LIVE } from "@/lib/agents/darwin/line-conflict-check";
import { OD_TRANSFER_REFILE_LIVE, OD_TRANSFER_TARGET, odTransferVerdict } from "@/lib/agents/darwin/od-transfer-refile-check";
import { PROTECTION_ITEM_REFILE_LIVE, protectionItemVerdict } from "@/lib/agents/darwin/protection-item-refile-check";
import { PROTECTION_ITEM_TARGET, PROTECTION_TRANSFER_KEY } from "@/lib/agents/knox/protection-item";
import { blankFrequency, OWN_UNIT_BLANK_PART_HOUR_LIVE, OWN_UNIT_REFILE_LIVE, ownUnitVerdict } from "@/lib/agents/darwin/own-unit-check";
import { HOURLY_FREQUENCY_LIVE, HOURLY_LINE_LIVE, hourlyVerdict } from "@/lib/agents/darwin/hourly-frequency-check";
import { HOURLY_FREQUENCY, frequencySpelling, PER_EVENT_SPELLINGS } from "@/lib/fee-frequency";
import type { CaseTrace, PublishedFee, ShadowCase } from "./shadow-lab/types";

/**
 * Database-sweep replays (#2533, plan step 4): the Darwin re-checks that take down or re-file live
 * fees run over the golden set's own publications. Each sweep's SQL selects live rows from the
 * production tables; here the same pure decision function (`find*` / `*Verdict`) reads rows built
 * from the fees the replayed pipeline published for one golden member, with that member's frozen
 * document text and address. A takedown removes the fee, a re-file changes its category or
 * frequency, and `measureGoldenSet` scores what is left, so a sweep that would take down or
 * re-file a fee the answer key says is right loses recall, and one that removes a known-wrong fee
 * gains precision. No database, no model call.
 *
 * What a sweep replay cannot see is named in its `keepsCodeValue` and the replay is `sweep, partial`:
 * other documents of the same bank, other banks' rows, the learned category model, and the bank's
 * live rate fees. The SQL word prefilters are not re-applied (the pure rule decides on every fee
 * the replay publishes), so a replay judges at least the fees prod's step would. Renames are not
 * replayed: the golden set scores category, price and frequency, not names.
 *
 * Each sweep reads its switches through `on(name)`, which is the switch's code value in the PR
 * head unless the replay holds it on or off.
 */

export type SweepAction =
  | { index: number; action: "takedown"; reason: string }
  | { index: number; action: "refile"; reason: string; canonicalFeeKey?: string; frequency?: string | null };

export interface SweepCase {
  text: string;
  url: string | null;
  caseKey: string;
}

export interface SweepReplay {
  /** The Darwin check the sweep replays. */
  check: string;
  /** Every `*_LIVE` switch the sweep reads, with its code value in the PR head. */
  switches: Readonly<Record<string, boolean>>;
  scope: "sweep" | "sweep, partial";
  replays: string;
  /** For `sweep, partial`: what the production sweep reads that the replay cannot. */
  keepsCodeValue?: string;
  run(fees: readonly PublishedFee[], c: SweepCase, on: (name: string) => boolean): SweepAction[];
}

/** One synthetic live row per published fee: ids are positions, one institution, one document. */
const DOCUMENT_ID = 1;
const INSTITUTION_ID = 1;
const id = (index: number) => index + 1;
const dollars = (cents: number | null | undefined) => (cents == null ? null : cents / 100);
/** Knox's extraction note as the sweeps' SQL reads it (`extraction_note`, `... excerpt="<line>"`). */
const note = (fee: PublishedFee) => `Knox deterministic extraction. Rosetta artifact #${DOCUMENT_ID}. excerpt="${fee.excerpt ?? ""}"`;
const fold = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const base = (fee: PublishedFee, index: number) => ({
  fee_published_id: id(index), fee_verified_id: id(index), institution_id: INSTITUTION_ID,
  fee_name: fee.feeName, amount: dollars(fee.amountCents), canonical_fee_key: fee.canonicalFeeKey,
});
const indexOf = (feePublishedId: number) => feePublishedId - 1;
const takedowns = (ids: Iterable<number>, reason: string): SweepAction[] =>
  [...ids].map((feeId) => ({ index: indexOf(feeId), action: "takedown" as const, reason }));
const NO_OTHER_ROWS = "the bank's other documents and other live rows, which each golden member (one document read once) does not have";

/** `bandedZeroRowsSql`: the lines of the text that carry the fee's name, and the line after each. */
function nameLines(text: string, name: string): string {
  const lines = text.split("\n");
  const wanted = fold(name);
  if (!wanted) return "";
  return lines.filter((line, n) => fold(line).includes(wanted) || (n > 0 && fold(lines[n - 1]).includes(wanted))).join("\n");
}

const flatPriced = (fee: PublishedFee) => fee.amountCents != null && fee.amountCents > 0;

export const SWEEP_REPLAYS: readonly SweepReplay[] = [
  {
    check: "darwin.banded_zero",
    switches: { BANDED_ZERO_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's banded-$0 re-check (`findBandedZeros`) on every published $0 overdraft, NSF and continuous-overdraft fee, with the lines of its text that carry its name",
    run(fees, c, on) {
      if (!on("BANDED_ZERO_TAKEDOWN_LIVE")) return [];
      const rows = fees.flatMap((fee, index) => fee.amountCents === 0 && BANDED_ZERO_CATEGORIES.has(fee.canonicalFeeKey ?? "")
        ? [{ ...base(fee, index), source_line: note(fee), document_lines: nameLines(c.text, fee.feeName ?? "") }] : []);
      return findBandedZeros(rows).matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.rate_floor",
    switches: { RATE_FLOOR_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's rate-floor re-check (`findRateFloors`) on every published flat fee above $0; the bank's live rate twins only label a match, so every match comes down as on prod",
    run(fees, _c, on) {
      if (!on("RATE_FLOOR_TAKEDOWN_LIVE")) return [];
      const rows = fees.flatMap((fee, index) => flatPriced(fee) ? [{ ...base(fee, index), source_line: note(fee), live_rates: [] }] : []);
      return findRateFloors(rows).matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.late_charge_bound",
    switches: { LATE_CHARGE_BOUND_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's late-charge cap/floor re-check (`findLateChargeBounds`) on every published fee",
    run(fees, _c, on) {
      if (!on("LATE_CHARGE_BOUND_TAKEDOWN_LIVE")) return [];
      return findLateChargeBounds(fees.map(base)).matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.no_fee_sentence",
    switches: { NO_FEE_SENTENCE_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's \"no ... fees\" sentence re-check (`findNoFeeSentences`) on every published fee above $0, with Knox's stored line",
    run(fees, _c, on) {
      if (!on("NO_FEE_SENTENCE_TAKEDOWN_LIVE")) return [];
      const rows = fees.flatMap((fee, index) => flatPriced(fee) ? [{ ...base(fee, index), source_line: note(fee) }] : []);
      return findNoFeeSentences(rows).matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.zero_waiver_row",
    switches: { ZERO_WAIVER_ROW_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's waiver-row $0 re-check (`findZeroWaiverRows`) on every published $0 fee, with Knox's stored line and the member's text as the artifact Knox read",
    run(fees, c, on) {
      if (!on("ZERO_WAIVER_ROW_TAKEDOWN_LIVE")) return [];
      const rows = fees.flatMap((fee, index) => fee.amountCents === 0 ? [{ ...base(fee, index), source_line: note(fee), artifact_id: DOCUMENT_ID }] : []);
      return findZeroWaiverRows(rows, new Map([[DOCUMENT_ID, c.text]])).matches
        .map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.free_list_item",
    switches: { FREE_LIST_ITEM_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's free-list item re-check (`findFreeListItems`) on every published priced fee whose Knox line joins a name line to a price line, with the member's text as the artifact Knox read",
    run(fees, c, on) {
      if (!on("FREE_LIST_ITEM_TAKEDOWN_LIVE")) return [];
      const stacked = new RegExp(FREE_LIST_ITEM_PREFILTER);
      const rows = fees.flatMap((fee, index) => flatPriced(fee) && stacked.test(note(fee))
        ? [{ ...base(fee, index), source_line: note(fee), artifact_id: DOCUMENT_ID }] : []);
      return findFreeListItems(rows, new Map([[DOCUMENT_ID, c.text]])).matches
        .map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.not_account_fee_line",
    switches: { NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's not-an-account-fee line re-check (`findNotAccountFeeLines`) on every published flat fee, with the member's text as the artifact Knox read: a dividend threshold on its Knox line, and a monthly maintenance fee under an online services section",
    run(fees, c, on) {
      if (!on("NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE")) return [];
      const rows = fees.flatMap((fee, index) => fee.amountCents != null && fee.amountCents >= 0
        ? [{ ...base(fee, index), source_line: note(fee), artifact_id: DOCUMENT_ID }] : []);
      return findNotAccountFeeLines(rows, new Map([[DOCUMENT_ID, c.text]])).matches
        .map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.credit_card_section",
    switches: { CREDIT_CARD_SECTION_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's credit card section re-check (`findCreditCardSectionFees`, Knox's `creditCardSectionRead`) on every published card replacement and rush card fee, with Knox's stored line and the member's text as the artifact Knox read",
    run(fees, c, on) {
      if (!on("CREDIT_CARD_SECTION_TAKEDOWN_LIVE")) return [];
      const keys: ReadonlySet<string> = new Set(CREDIT_CARD_SECTION_KEYS);
      const rows = fees.flatMap((fee, index) => fee.amountCents != null && fee.amountCents >= 0 && fee.canonicalFeeKey != null && keys.has(fee.canonicalFeeKey)
        ? [{ ...base(fee, index), source_line: note(fee), artifact_id: DOCUMENT_ID }] : []);
      return findCreditCardSectionFees(rows, new Map([[DOCUMENT_ID, c.text]])).matches
        .map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.loan_payment_example",
    switches: { DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE: LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's loan payment example re-check (`findLoanPaymentExamples`) on every published fee above $0, with Knox's stored line",
    run(fees, _c, on) {
      if (!on("DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE")) return [];
      const rows = fees.flatMap((fee, index) => flatPriced(fee) ? [{ ...base(fee, index), source_line: note(fee) }] : []);
      return findLoanPaymentExamples(rows).matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.canadian_document",
    switches: { CANADIAN_DOCUMENT_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's Canadian-document re-check (`canadianDocument`, the rule its SQL applies) on the member's text; a match takes down every fee read from it",
    run(fees, c, on) {
      if (!on("CANADIAN_DOCUMENT_TAKEDOWN_LIVE") || !canadianDocument(c.text)) return [];
      return fees.map((_fee, index) => ({ index, action: "takedown", reason: "canadian_document" }));
    },
  },
  {
    check: "darwin.non_deposit_document",
    switches: {
      NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE, BROKERAGE_DOCUMENT_TAKEDOWN_LIVE, CARD_PROGRAM_TAKEDOWN_LIVE,
      OPENING_DOCUMENT_TAKEDOWN_LIVE, CREDIT_TERMS_TAKEDOWN_LIVE,
    },
    scope: "sweep, partial",
    replays: "Darwin's non-deposit document re-check (`nonDepositTakedownReason`, with every sub-switch) on each published fee, its document's address and the opening of its text",
    keepsCodeValue: "nothing it reads, but a member frozen with no document address is never judged, as on prod",
    run(fees, c, on) {
      const switches = {
        live: on("NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE"), brokerageLive: on("BROKERAGE_DOCUMENT_TAKEDOWN_LIVE"),
        cardProgramLive: on("CARD_PROGRAM_TAKEDOWN_LIVE"), openingLive: on("OPENING_DOCUMENT_TAKEDOWN_LIVE"), creditTermsLive: on("CREDIT_TERMS_TAKEDOWN_LIVE"),
      };
      return fees.flatMap((fee, index) => {
        const reason = nonDepositTakedownReason({
          documentUrl: c.url, sourceDocumentId: DOCUMENT_ID, canonicalFeeKey: fee.canonicalFeeKey, feeName: fee.feeName,
          documentOpening: c.text.slice(0, OPENING_SCAN_CHARS),
        }, switches);
        return reason ? [{ index, action: "takedown" as const, reason }] : [];
      });
    },
  },
  {
    check: "darwin.loan_section",
    switches: { LOAN_SECTION_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's loan-section re-check (`findLoanSectionFees`) on the member's text and every fee published from it",
    run(fees, c, on) {
      if (!on("LOAN_SECTION_TAKEDOWN_LIVE")) return [];
      const found = findLoanSectionFees([{ source_document_id: DOCUMENT_ID, document_url: c.url, normalized_text: c.text, fees: fees.map(base) }]);
      return found.matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.card_program_section",
    switches: { CARD_PROGRAM_SECTION_TAKEDOWN_LIVE },
    scope: "sweep",
    replays: "Darwin's card-program-section re-check (`findCardProgramSectionFees`) on the member's text and every fee published from it",
    run(fees, c, on) {
      if (!on("CARD_PROGRAM_SECTION_TAKEDOWN_LIVE")) return [];
      const found = findCardProgramSectionFees([{ source_document_id: DOCUMENT_ID, document_url: c.url, normalized_text: c.text, fees: fees.map(base) }]);
      return found.matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.live_fragment",
    switches: { FRAGMENT_NAME_TAKEDOWN_LIVE, QUALIFIED_FRAGMENT_TAKEDOWN_LIVE },
    scope: "sweep, partial",
    replays: "Darwin's live fragment-name re-check (`findLiveFragments`, with its qualified shapes, and the comparator shapes at their code value) on every published fee; its takedowns come down",
    keepsCodeValue: `rename collisions with ${NO_OTHER_ROWS}`,
    run(fees, _c, on) {
      if (!on("FRAGMENT_NAME_TAKEDOWN_LIVE")) return [];
      const rows = fees.map((fee, index) => ({ ...base(fee, index), source_document_id: DOCUMENT_ID }));
      const found = findLiveFragments(rows, new Set(), { qualified: on("QUALIFIED_FRAGMENT_TAKEDOWN_LIVE"), comparator: COMPARATOR_FRAGMENT_REREAD_LIVE });
      return takedowns(found.matches.filter((m) => m.action === "takedown").map((m) => m.feePublishedId), "live_fragment");
    },
  },
  {
    check: "darwin.same_line_read",
    switches: { SAME_LINE_READ_TAKEDOWN_LIVE },
    scope: "sweep, partial",
    replays: "Darwin's same-line second-read re-check (`findSameLineReads`) on the fees published from one line of the member's text, with how often the text prints that line",
    keepsCodeValue: "the fee's audience and product (the replay has neither, so every fee groups as unknown audience, no product)",
    run(fees, c, on) {
      if (!on("SAME_LINE_READ_TAKEDOWN_LIVE")) return [];
      const folded = fold(c.text);
      const prints = (excerpt: string) => (excerpt ? folded.split(excerpt).length - 1 : 0);
      const rows = fees.flatMap((fee, index) => {
        const excerpt = fold(fee.excerpt ?? "");
        return fee.amountCents == null || !excerpt ? [] : [{
          ...base(fee, index), variant: "", frequency: fee.frequency ?? null, audience: "unknown", product_key: "",
          source_document_id: DOCUMENT_ID, excerpt, line_prints: prints(excerpt),
        }];
      });
      // The SQL keeps only lines more than one live row reads (`reads > 1`); `findSameLineReads` groups them again.
      return findSameLineReads(rows).matches.map((m) => ({ index: indexOf(m.feePublishedId), action: "takedown", reason: m.reason }));
    },
  },
  {
    check: "darwin.line_conflict",
    switches: { LINE_CONFLICT_TAKEDOWN_LIVE, LINE_CONFLICT_OWN_UNIT_LIVE },
    scope: "sweep, partial",
    replays: "Darwin's line-conflict re-check (`findLineConflicts`, with the own-unit reading) on the fees published under one name and price from the member's text; retired readings come down",
    keepsCodeValue: "the learned category model (`loadCategoryModel` reads it from the database; the replay runs with none, as the step does when it cannot load it)",
    run(fees, c, on) {
      if (!on("LINE_CONFLICT_TAKEDOWN_LIVE")) return [];
      const rows = fees.flatMap((fee, index) => fee.canonicalFeeKey == null ? [] : [{
        ...base(fee, index), canonical_fee_key: fee.canonicalFeeKey, rate_percent: null, variant_type: null, source_url: c.url,
        frequency: fee.frequency ?? null, fee_audience: null, published_at: null, source_document_id: DOCUMENT_ID, conditions: note(fee),
      }]);
      const found = findLineConflicts(rows, null, { ownUnitLive: on("LINE_CONFLICT_OWN_UNIT_LIVE") });
      return takedowns(found.verdicts.flatMap((verdict) => verdict.retired.map((retired) => retired.feePublishedId)), "line_conflict");
    },
  },
  {
    check: "darwin.od_transfer_refile",
    switches: { OD_TRANSFER_REFILE_LIVE },
    scope: "sweep",
    replays: `Darwin's overdraft-transfer re-file (\`odTransferVerdict\`) on every published overdraft fee; a \`refile\` moves it to ${OD_TRANSFER_TARGET}`,
    run(fees, _c, on) {
      if (!on("OD_TRANSFER_REFILE_LIVE")) return [];
      return fees.flatMap((fee, index) => {
        if (fee.canonicalFeeKey !== "overdraft" || fee.amountCents == null) return [];
        const verdict = odTransferVerdict({ ...base(fee, index), canonical_fee_key: "overdraft", source_line: note(fee) });
        return verdict?.outcome === "refile" ? [{ index, action: "refile" as const, reason: verdict.reason, canonicalFeeKey: OD_TRANSFER_TARGET }] : [];
      });
    },
  },
  {
    check: "darwin.protection_item_refile",
    switches: { PROTECTION_ITEM_REFILE_LIVE },
    scope: "sweep",
    replays: `Darwin's protection-item re-file (\`protectionItemVerdict\`) on every published ${PROTECTION_TRANSFER_KEY} fee, with the member's text; a \`refile\` moves it to ${PROTECTION_ITEM_TARGET}`,
    run(fees, c, on) {
      if (!on("PROTECTION_ITEM_REFILE_LIVE")) return [];
      return fees.flatMap((fee, index) => {
        if (fee.canonicalFeeKey !== PROTECTION_TRANSFER_KEY || fee.amountCents == null) return [];
        const verdict = protectionItemVerdict({ ...base(fee, index), canonical_fee_key: PROTECTION_TRANSFER_KEY, source_text: c.text });
        return verdict?.outcome === "refile" ? [{ index, action: "refile" as const, reason: verdict.reason, canonicalFeeKey: PROTECTION_ITEM_TARGET }] : [];
      });
    },
  },
  {
    check: "darwin.own_unit",
    switches: { OWN_UNIT_REFILE_LIVE, OWN_UNIT_BLANK_PART_HOUR_LIVE },
    scope: "sweep",
    replays: "Darwin's own-unit re-file (`ownUnitVerdict`) on every published per-event or blank-frequency fee, with the member's text; a `refile` sets the unit its line prices (a blank frequency under the part-hour switch, the rest under the per-item one)",
    run(fees, c, on) {
      return fees.flatMap((fee, index) => {
        const spelling = frequencySpelling(fee.frequency);
        if (fee.amountCents == null || fee.canonicalFeeKey == null || (spelling != null && !PER_EVENT_SPELLINGS.includes(spelling))) return [];
        const verdict = ownUnitVerdict({ ...base(fee, index), canonical_fee_key: fee.canonicalFeeKey, source_document_id: DOCUMENT_ID,
          frequency: fee.frequency ?? null, conditions: note(fee) }, c.text);
        if (verdict?.outcome !== "refile") return [];
        if (!(blankFrequency(verdict.from) ? on("OWN_UNIT_BLANK_PART_HOUR_LIVE") : on("OWN_UNIT_REFILE_LIVE"))) return [];
        return [{ index, action: "refile" as const, reason: `own_unit: ${verdict.unit}`, frequency: verdict.unit }];
      });
    },
  },
  {
    check: "darwin.hourly_frequency",
    switches: { HOURLY_FREQUENCY_LIVE, HOURLY_LINE_LIVE },
    scope: "sweep",
    replays: "Darwin's hourly frequency re-check (`hourlyVerdict`) on every published fee with Knox's stored line; a `set` makes it hourly (a line-only read under the line switch)",
    run(fees, _c, on) {
      if (!on("HOURLY_FREQUENCY_LIVE")) return [];
      return fees.flatMap((fee, index) => {
        if (fee.amountCents == null) return [];
        const verdict = hourlyVerdict(fee.feeName, fee.canonicalFeeKey, fee.frequency ?? null, fee.excerpt, dollars(fee.amountCents));
        if (verdict?.action !== "set" || (verdict.basis === "line" && !on("HOURLY_LINE_LIVE"))) return [];
        return [{ index, action: "refile" as const, reason: `hourly_frequency: ${verdict.basis}`, frequency: HOURLY_FREQUENCY }];
      });
    },
  },
];

/** Switch name -> the sweep that reads it. */
export const SWEEP_SWITCHES: ReadonlyMap<string, SweepReplay> = new Map(
  SWEEP_REPLAYS.flatMap((sweep) => Object.keys(sweep.switches).map((name) => [name, sweep] as const)),
);

/** A switch's value for one replay: the override when given, else its code value in the PR head. */
export function sweepSwitches(overrides: Readonly<Record<string, boolean>> = {}): (name: string) => boolean {
  return (name) => overrides[name] ?? SWEEP_SWITCHES.get(name)?.switches[name] ?? false;
}

export interface SweptFee {
  fee: PublishedFee;
  check: string;
  action: SweepAction["action"];
  reason: string;
}

/**
 * Runs every sweep, in `SWEEP_REPLAYS` order, over one member's publications: each sweep reads what
 * the sweeps before it left live, as the verify step's checks run one after another.
 */
export function sweepPublished(published: readonly PublishedFee[], c: SweepCase, on: (name: string) => boolean): { published: PublishedFee[]; swept: SweptFee[] } {
  let live = [...published];
  const swept: SweptFee[] = [];
  for (const sweep of SWEEP_REPLAYS) {
    const actions = sweep.run(live, c, on);
    if (actions.length === 0) continue;
    const down = new Set<number>();
    const next = [...live];
    for (const action of actions) {
      const fee = live[action.index];
      if (!fee || down.has(action.index)) continue;
      swept.push({ fee, check: sweep.check, action: action.action, reason: action.reason });
      if (action.action === "takedown") down.add(action.index);
      else next[action.index] = { ...next[action.index], ...(action.canonicalFeeKey ? { canonicalFeeKey: action.canonicalFeeKey } : {}),
        ...(action.frequency !== undefined ? { frequency: action.frequency } : {}) };
    }
    live = next.filter((_fee, index) => !down.has(index));
  }
  return { published: live, swept };
}

/** Every trace with the sweeps applied to what it published. Traces of members with no text are unchanged. */
export function sweepTraces(traces: readonly CaseTrace[], cases: ReadonlyMap<string, ShadowCase>, on: (name: string) => boolean): CaseTrace[] {
  return traces.map((trace) => {
    const c = cases.get(trace.caseKey);
    const text = c?.document.text;
    if (!c || text == null || trace.published.length === 0) return trace;
    return { ...trace, published: sweepPublished(trace.published, { text, url: c.document.url, caseKey: c.caseKey }, on).published };
  });
}
