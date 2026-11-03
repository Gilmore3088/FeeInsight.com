import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { classifyFeeText, returnedItemServiceName, waiverAdviceName, waiverAdvicePrefix, wireServiceMonthlyName, wireServiceSubscription, zeroPrintedForRead, zeroPrintedOnLine } from "@/lib/agents/knox/rules";
import { accountlessMonthlyExcerpt, accountlessMonthlyOnPage } from "@/lib/agents/knox/accountless-monthly";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { depositedCardReturnRead, frontMatterName, withReturnBesideNsf } from "@/lib/agents/knox/specialists";
import { reviewReadName } from "@/lib/agents/knox/read-name-review";
import { PLAIN_RETURNED_ITEM } from "@/lib/fee-category-guard";
import { withoutOcrLeaderNoise } from "@/lib/agents/knox/ocr-leader-noise";
import { STOP_PAYMENT_VARIANT, stopPaymentVariantFor, stopPaymentVariantName } from "@/lib/custom-report/stop-payment-variant";
import { iraSectionClosingFee } from "@/lib/custom-report/ira-section-fee";
import { audienceRowLineCount, audienceSectionHeading } from "@/lib/agents/knox/audience-section";
import { ACCOUNT_PRODUCT_CATEGORIES } from "@/lib/agents/knox/lineup";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees Knox v177 no longer reads as they are live (Knox re-read backlog dry run 8,
 * Nov 3; decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). Each was named or filed
 * by words from another part of the page than the fee's own row. Knox v177 reads new ones right; the ones read
 * before stay live:
 *
 * - `waiver_column_name`: a name that is a waiver column's advice ("Use Online BillPay, HonorPay or
 *   Account-To-Account Transfers"), alone or composed with the next column's item, live under another category
 *   than its own words file (`waiverAdviceName`, `waiverAdvicePrefix`). Honor FCU's "Use Online BillPay, HonorPay
 *   or Account-To-Account Transfers: Verification of Deposits" $25 is live as bill_pay (77750).
 * - `front_matter_name`: a name read from a page's front matter ("meta-fb:pages: meta-generator: WordPress
 *   7.1.4 ...", `frontMatterName`), Citizens Bank's 167014 and 101378.
 * - `wire_subscription`: a wire service's monthly module or package filed as a wire's price
 *   (`wireServiceSubscription`): "International Wire Module | $20.00 | Per Month" (152355), "Premium Package (per
 *   month) (includes ACH & Domestic Wire access)" (85500).
 * - `ira_section_closing`: an early closure fee printed only in an IRA's own section, the IRA's closing fee
 *   (`iraSectionClosingFee`, read on the text Knox read): Progressions CU's "INDIVIDUAL RETIREMENT ACCOUNT (IRA)
 *   FEES" / "Account Closure Fee $25.00" (94053).
 *
 * Version 2 (Knox v178, re-read backlog dry run 9, Nov 3) adds two rules Knox v178 holds new reads by:
 *
 * - `returned_item_service`: an NSF fee whose name is a returned item's handling service, which no type holds
 *   (`returnedItemServiceName`: special handling, a re-clear, a reroute, or a service fee priced per month, in a
 *   name that does not say NSF): "Returned Item Special Handling Item" $10 (21594).
 * - `accountless_monthly_sentence`: a monthly maintenance fee whose stored line is a reward bullet ("Waived $10
 *   monthly maintenance fee"; live 117986 is one, kept because its page's table prints "$10 or $0 | Monthly Fee") or a "Your $12 monthly maintenance fee ..." sentence
 *   (`accountlessMonthlyExcerpt`, on Knox's stored `excerpt="..."`), judged on the text Knox read as Knox judges
 *   it (`accountlessMonthlyOnPage`): a row of the page printing the fee at that price, or an account heading right
 *   above the sentence, keeps the fee.
 *
 * Version 3 (Knox v179, re-read backlog dry run 10, Nov 3) adds two rules on Knox's stored line (`excerpt="..."`),
 * judged as Knox v179 judges a new read:
 *
 * - `zero_not_printed`: a live $0 whose own line prints no free price ("$0", "None", "Free", "No charge", "no fee",
 *   a "Waived" cell) or offers one against a price ("$0 or $4.95", `zeroPrintedOnLine`): North State Bank's
 *   "Monthly maintenance fee waived when minimum account balance requirement is met." A stored line that prints no
 *   free price is judged on the text Knox read, as Knox judges it (`zeroPrintedForRead`): a bare "$0" cell right
 *   above it on a stacked page keeps the fee ("$0" / "per transfer/advance ..."; live 36427 and 36428), and so does
 *   an unconditional waiver ("Waived Annual IRA Fee", 134219; "Waived Non-QCBT ATM Transactions", 140028). A stored
 *   line that is cut (it ends in a dot leader, or at the 180-character cut) or missing, or whose text is gone, is
 *   not judged: the price may sit past the cut.
 * - `audience_section_untagged`: a live fee with no product whose stored line sits in a section headed by an
 *   audience (`audienceSectionHeading` on the text Knox read: "Senior Perks (60 & Over)" over "Fax Service | FREE"),
 *   while the bank has a live fee of the same name with no product at another price (Midwest Members FCU's $1 fax,
 *   #162230). The audience's price reads as the general fee's; Knox v179 reads it under the heading as its product.
 *   Only in a category that takes no account as its product (`ACCOUNT_PRODUCT_CATEGORIES`, as Knox); a stored line
 *   that no single line of the text holds is not judged (`audienceUnplaced`, step detail `audience_unplaced`).
 *
 * Version 4 (Knox v181, re-read backlog dry run 12, Nov 3; review of #2979) adds two rules Knox v181 re-files new
 * reads by, judged on the text Knox read with the same shared functions:
 *
 * - `stop_payment_variant`: a live fee not filed as stop_payment that is a bulleted variant under a stop payment row
 *   printing its own price (`stopPaymentVariantFor`, `custom-report/stop-payment-variant.ts`): St. Louis Community
 *   FCU's "• Corporate Check | $15.00" under "Stop Payment Fee – Check or ACH (per item): | $20.00", live as a $15
 *   cashier's check (40324). Knox v181 reads it as "Stop Payment Fee – Check or ACH (per item): Corporate Check".
 * - `deposited_card_return`: a live NSF fee whose labeled fee card's own description says the member deposited or
 *   cashed the returned item (`depositedCardReturnRead`, `labeledFeeCardDescription`): ESL FCU's "Returned Item
 *   Fee" $10, "For each item you deposit or cash that is returned unpaid" (68629). Knox v181 files it as the
 *   deposited item return.
 *
 * Version 5 (Knox v182, slice dry run and cross-category scan, Nov 3) adds three rules Knox v182 holds, re-files or
 * drops new reads by, judged with the same shared functions:
 *
 * - `wire_service_monthly_fee`: a wire service's own monthly charge filed as an account's monthly fee
 *   (`wireServiceMonthlyName`: Ameris Bank's "Online Wire Monthly Maintenance Fee | $25.00"), which no type holds.
 * - `read_name_review`: a live fee Knox's last name review drops or re-files (`reviewReadName`, on the stored line and
 *   the text Knox read): a price the line says is a deposit to open or join ("Only a $25 membership deposit to get
 *   started"), a capitals label whose price sits in the next cell's own label ("COUNTER CHECKS | PER DEBIT ITEM •
 *   $32"), a box's late charge filed as a loan's ("Box Late Fee"), or paper statements offered in a check image's
 *   name. A rename alone is no match.
 * - `return_beside_nsf`: a plain returned check or item filed as NSF that Knox v182 files as the deposited item
 *   return (`withReturnBesideNsf`, with the live NSF and deposited item return fees read from the same text as the
 *   page's other reads): beside an NSF fee the schedule prints free ("Insufficient Funds (NSF) | $0" over "Returned
 *   Check | $20", 133756), or beside a deposited item return at its own price and an NSF fee above it.
 *
 * Without this check a re-read would publish the right fee beside the live wrong one: Darwin's re-read category
 * check (`reread-category-check.ts`) judges only fees with a settled Knox re-read request, and these have none.
 * Version 4 also compares a stored line and the text with OCR leader noise blanked in both (`ocrComparable`).
 *
 * Each verify step reads the live flat fees each rule could match (`sectionMisreadRowsSql`: the name pre-filters,
 * and for the IRA rule a text that names an IRA). An admin-corrected fee is never read; an IRA or monthly sentence
 * candidate whose text is gone is not judged. An institution-scoped run reads that institution's only. Switched on
 * (`SECTION_MISREAD_TAKEDOWN_LIVE`), a match goes through the shared 12-hour second look (check
 * `darwin.section_misread`) and is archived on its second failure: rolled back with its reason, its verified row
 * rejected with the reason's flag so publish does not bring it back, never deleted, and a
 * `darwin.section_misread_takedown` event lists them. The fee is not re-filed in place: the bank's next read
 * files the row by Knox v177. In a dry run, or with the switch off (the default), it only reports.
 *
 * Dry run, prod read-only, 2026-11-03: see docs/project/findings/2026-11-03-knox-backlog-dry-run-8-misreads.md.
 */
export const SECTION_MISREAD_CHECK = "darwin.section_misread";
export const SECTION_MISREAD_CHECK_VERSION = 5;
/** The switch: off, the step only reports; on, matches come down after the second look. */
export const SECTION_MISREAD_TAKEDOWN_LIVE = false;
export const WAIVER_COLUMN_NAME_REASON = "waiver_column_name";
export const FRONT_MATTER_NAME_REASON = "front_matter_name";
export const WIRE_SUBSCRIPTION_REASON = "wire_subscription";
export const IRA_SECTION_CLOSING_REASON = "ira_section_closing";
export const RETURNED_ITEM_SERVICE_REASON = "returned_item_service";
export const ACCOUNTLESS_MONTHLY_REASON = "accountless_monthly_sentence";
export const ZERO_NOT_PRINTED_REASON = "zero_not_printed";
export const AUDIENCE_SECTION_UNTAGGED_REASON = "audience_section_untagged";
export const STOP_PAYMENT_VARIANT_REASON = "stop_payment_variant";
export const DEPOSITED_CARD_RETURN_REASON = "deposited_card_return";
export const WIRE_SERVICE_MONTHLY_REASON = "wire_service_monthly_fee";
export const READ_NAME_REVIEW_REASON = "read_name_review";
export const RETURN_BESIDE_NSF_REASON = "return_beside_nsf";
export const SECTION_MISREAD_REASONS = [WAIVER_COLUMN_NAME_REASON, FRONT_MATTER_NAME_REASON, WIRE_SUBSCRIPTION_REASON, IRA_SECTION_CLOSING_REASON, RETURNED_ITEM_SERVICE_REASON, ACCOUNTLESS_MONTHLY_REASON, ZERO_NOT_PRINTED_REASON, AUDIENCE_SECTION_UNTAGGED_REASON, STOP_PAYMENT_VARIANT_REASON, DEPOSITED_CARD_RETURN_REASON, WIRE_SERVICE_MONTHLY_REASON, READ_NAME_REVIEW_REASON, RETURN_BESIDE_NSF_REASON] as const;
export type SectionMisreadKind = (typeof SECTION_MISREAD_REASONS)[number];
export const SECTION_MISREAD_LIMIT = 10_000;
export const SECTION_MISREAD_SAMPLES = 20;
export const SECTION_MISREAD_MAX_ROWS = 10_000;
const TEXT_CHUNK = 50;

/** Postgres pre-filters, each a superset of its Knox rule. */
export const WAIVER_ADVICE_NAME_SQL = String.raw`^\W*(use|enroll\s+in|sign\s+up\s+for|switch\s+to|maintain|keep)\s`;
export const FRONT_MATTER_NAME_SQL = String.raw`^\s*(meta-[a-z0-9_.:-]*|canonical)\s*:`;
export const WIRE_SUBSCRIPTION_NAME_SQL = String.raw`(module|package|subscription)`;
export const IRA_TEXT_SQL = String.raw`(\mIRAs?\M|individual\s+retirement|retirement\s+(account|plan|savings))`;
export const RETURNED_ITEM_SERVICE_NAME_SQL = String.raw`(special\s+handling|re-?clear|re-?rout|service\s+(fee|charge))`;
export const ACCOUNTLESS_MONTHLY_LINE_SQL = String.raw`excerpt="?\W*(waived|no|free|your)\s+\$`;
/** Version 3: a live $0 with a stored line at all. */
export const STORED_LINE_SQL = String.raw`excerpt=`;
/** Version 3: a text that could head a section by an audience (a superset of `audienceSectionHeading`'s words). */
export const AUDIENCE_TEXT_SQL = String.raw`(senior|retiree|youth|junior|teen|minor|young\s+adult|[0-9]{2}\s*(\+|&)|[0-9]{2}\s*(years?|yrs\.?)?\s*(of\s+age\s+|old\s+)?(and|or)\s|ages?\s+[0-9]{2}|(over|under)\s+(the\s+)?age|(over|under)\s+[0-9]{2})`;
/** Version 4: a name that could be a stop payment variant's label (a superset of `STOP_PAYMENT_VARIANT`'s ends). */
export const STOP_PAYMENT_VARIANT_NAME_SQL = String.raw`(checks?|series|range|drafts?|orders?|ach|debits?|items?|payments?)\W*$`;
/** Version 4: a text with a bullet and a stop payment label (`stopPaymentVariantRows` reads no other). */
export const STOP_PAYMENT_TEXT_SQL = String.raw`stop\s*-?\s*pay`;
/** Version 4: a text with a labeled fee card ("Fee TypeReturned Item Fee") that says deposit or cash. */
export const FEE_CARD_TEXT_SQL = String.raw`(^|\n)\s*fee\s*(type|name)`;
export const DEPOSIT_OR_CASH_TEXT_SQL = String.raw`(deposit|cash)`;
/** Version 5: a monthly fee's name that names a wire (a superset of `wireServiceMonthlyName`). */
export const WIRE_MONTHLY_NAME_SQL = String.raw`\mwires?\M`;
/** Version 5: a stored line or name `reviewReadName` could drop or re-file by (supersets of its rules). */
export const OPENING_DEPOSIT_LINE_SQL = String.raw`(membership|opening|initial)\s+deposit|deposit\s+(to|will)\s+(open|join|get\s+started)|(deposit|open\s+(an?\s+)?(account|membership))\s+(of|with)\s`;
export const CAPS_CELL_LINE_SQL = String.raw`\|\s*[A-Z][A-Z0-9 &/'’-]{3,}\s*[•:–-]\s*\$`;
export const BOX_NAME_SQL = String.raw`\mbox`;
export const PAPER_OFFER_SQL = String.raw`(paper|printed|mailed)[^|]{0,12}statement`;
/** Version 5: a plain returned check or item (`PLAIN_RETURNED_ITEM`). */
export const PLAIN_RETURN_NAME_SQL = String.raw`^\s*return(ed)?\s+(check|item)s?(\s+(fee|charge)s?)?\s*:?\s*$`;
/** Knox stores at most 180 characters of a held read's line, and a cut line can end in its dot leader. */
const STORED_LINE_CUT = 180;
const DOT_LEADER_END = /(?:(?:\.\s?){2,}|…)\s*$/;

export interface SectionMisreadRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  /** The artifact Knox's note names: the text Knox read. */
  artifact_id: number | string | null;
  /** The live fee's frequency (version 2's returned item service rule). */
  frequency?: string | null;
  /** Knox's note, with the stored `excerpt="..."` (version 2's monthly sentence rule). */
  source_line?: string | null;
  /** Version 3: the fee has no product and the bank has a live fee of its name, with no product, at another price. */
  audience_candidate?: boolean | null;
  /** Version 5: the other live NSF and deposited item return fees read from the same text (a plain return's page reads). */
  siblings?: Array<{ fee_name: string | null; amount: number | string | null; canonical_fee_key: string | null }> | null;
}

export interface SectionMisreadMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  kind: SectionMisreadKind;
  reason: string;
}

export interface SectionMisreadFindings {
  checked: number;
  /** IRA, monthly sentence and version 3 $0 candidates whose text is gone: not judged (a version 4 candidate whose text is gone is not counted: its rule needs the text to select it). */
  noText: number;
  /** Version 3: live $0 candidates whose stored line is missing or cut: not judged. */
  cut: number;
  /** Version 3: untagged audience candidates whose stored line no single line of the text holds: not judged. */
  audienceUnplaced: number;
  matched: number;
  byKind: Record<SectionMisreadKind, number>;
  institutions: number;
  samples: SectionMisreadMatch[];
}

export interface SectionMisreadResult extends SectionMisreadFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyKinds(): Record<SectionMisreadKind, number> {
  return { waiver_column_name: 0, front_matter_name: 0, wire_subscription: 0, ira_section_closing: 0, returned_item_service: 0, accountless_monthly_sentence: 0, zero_not_printed: 0, audience_section_untagged: 0, stop_payment_variant: 0, deposited_card_return: 0, wire_service_monthly_fee: 0, read_name_review: 0, return_beside_nsf: 0 };
}

/**
 * Version 3: an untagged fee whose bank prices its name otherwise, in a category that takes no account as its product
 * (Knox reads an audience heading as the product only there: `withLineupFromText`, `ACCOUNT_PRODUCT_CATEGORIES`).
 */
function audienceCandidate(row: SectionMisreadRow): boolean {
  return !!row.audience_candidate && !ACCOUNT_PRODUCT_CATEGORIES.has(row.canonical_fee_key ?? "");
}

/** Version 4: a live fee not filed as stop_payment whose name could be a stop payment variant's label, with a stored line. */
function variantCandidate(row: SectionMisreadRow): boolean {
  return row.canonical_fee_key !== "stop_payment" && (num(row.amount) ?? 0) > 0 && STOP_PAYMENT_VARIANT.test((row.fee_name ?? "").replace(/\s+/g, " ").trim()) && !!excerptOf(row.source_line);
}

/** Version 4: a live NSF fee, judged by its labeled fee card's description. */
function cardCandidate(row: SectionMisreadRow): boolean {
  return row.canonical_fee_key === "nsf";
}

/** Version 5: a live fee `reviewReadName` could drop or re-file, with a stored line. */
function reviewCandidate(row: SectionMisreadRow): boolean {
  const name = (row.fee_name ?? "").trim();
  const line = row.source_line ?? "";
  if (!excerptOf(row.source_line)) return false;
  if (row.canonical_fee_key === "late_payment") return /\bbox/i.test(name);
  if (row.canonical_fee_key === "check_image") return /(?:paper|printed|mailed)[^|]{0,12}statement/i.test(name);
  return (num(row.amount) ?? 0) > 0 && (new RegExp(OPENING_DEPOSIT_LINE_SQL, "i").test(line) || (!/[a-z]/.test(name) && new RegExp(CAPS_CELL_LINE_SQL).test(line)));
}

/** Version 5: a live plain returned check or item filed as NSF. */
function returnCandidate(row: SectionMisreadRow): boolean {
  return row.canonical_fee_key === "nsf" && (num(row.amount) ?? 0) > 0 && PLAIN_RETURNED_ITEM.test((row.fee_name ?? "").trim());
}

/**
 * Pure, version 5: Knox v182's last name review of a live fee on its stored line and the text Knox read, when it drops
 * the read or files it elsewhere (a rename alone is no match), or null.
 */
export function reviewedReadKind(row: SectionMisreadRow, text: string): { kind: SectionMisreadKind; evidence: string } | null {
  const line = excerptOf(row.source_line);
  const key = row.canonical_fee_key;
  const amount = num(row.amount);
  if (!line || !key || amount == null) return null;
  const name = (row.fee_name ?? "").trim();
  const reviewed = reviewReadName({ canonicalHint: key, feeName: name, amount, excerpt: line }, withoutOcrLeaderNoise(text));
  if (!reviewed) return null;
  if (reviewed.read == null) return { kind: READ_NAME_REVIEW_REASON, evidence: `${reviewed.rule}: ${line.slice(0, 70)}` };
  if (reviewed.read.canonicalHint !== key) return { kind: READ_NAME_REVIEW_REASON, evidence: `${reviewed.rule}: ${name.slice(0, 50)} is ${reviewed.read.canonicalHint}, not ${key}` };
  return null;
}

/**
 * Pure, version 5: a live plain returned item filed as NSF that Knox v182 files as the deposited item return, judged
 * with `withReturnBesideNsf` on the live fee and the other live NSF and deposited item return fees from its text.
 */
export function returnBesideNsfKind(row: SectionMisreadRow, text: string | undefined): { kind: SectionMisreadKind; evidence: string } | null {
  if (!returnCandidate(row)) return null;
  const name = (row.fee_name ?? "").trim();
  const amount = num(row.amount) as number;
  const read = { feeName: name, amount, canonicalHint: "nsf" as string | null };
  const others = (row.siblings ?? []).map((sibling) => ({ feeName: (sibling.fee_name ?? "").trim(), amount: num(sibling.amount), canonicalHint: sibling.canonical_fee_key }));
  const [filed] = withReturnBesideNsf([read, ...others], [], text);
  return filed.canonicalHint === "deposited_item_return"
    ? { kind: RETURN_BESIDE_NSF_REASON, evidence: `${name.slice(0, 50)} $${amount} beside ${others.map((other) => `${other.canonicalHint} $${other.amount}`).join(", ").slice(0, 80) || "a free NSF fee"}` }
    : null;
}

/**
 * Pure, version 4: the Knox v181 rule a live fee matches on the text Knox read (OCR leader noise blanked, as Knox
 * reads it), or null.
 */
export function textMisreadKind(row: SectionMisreadRow, text: string): { kind: SectionMisreadKind; evidence: string } | null {
  const name = (row.fee_name ?? "").trim();
  const amount = num(row.amount) ?? 0;
  const read = withoutOcrLeaderNoise(text);
  if (variantCandidate(row)) {
    const variant = stopPaymentVariantFor(read, name, amount, excerptOf(row.source_line));
    if (variant) return { kind: STOP_PAYMENT_VARIANT_REASON, evidence: `${stopPaymentVariantName(variant).slice(0, 80)}, not ${row.canonical_fee_key ?? "none"}` };
  }
  if (cardCandidate(row)) {
    const filed = depositedCardReturnRead({ canonicalHint: "nsf", feeName: name, amount }, read);
    if (filed.canonicalHint !== "nsf") return { kind: DEPOSITED_CARD_RETURN_REASON, evidence: `${name.slice(0, 60)} is ${filed.canonicalHint} by its card` };
  }
  return null;
}

/** Version 3: a live $0 whose stored line prints no free price, judged on its text. */
function zeroLineCandidate(row: SectionMisreadRow): boolean {
  const amount = num(row.amount);
  if (amount !== 0) return false;
  const stored = storedLineMisreadKind(row.source_line, amount);
  return stored != null && stored !== "cut" && stored.kind === ZERO_NOT_PRINTED_REASON;
}

/**
 * Pure, version 3: the rule a live $0's stored line matches, or "cut" when a live $0's line is missing or cut
 * and so not judged.
 */
export function storedLineMisreadKind(sourceLine: string | null | undefined, amount: number): { kind: SectionMisreadKind; evidence: string } | "cut" | null {
  const line = excerptOf(sourceLine);
  if (amount !== 0) return null;
  if (!line || line.length >= STORED_LINE_CUT || DOT_LEADER_END.test(line)) return "cut";
  return zeroPrintedOnLine(line) ? null : { kind: ZERO_NOT_PRINTED_REASON, evidence: line.slice(0, 80) };
}

/** The name's last words, two or more, file under `key` on their own: the item after the advice is the live fee's. */
function tailFilesUnder(name: string, key: string | null): boolean {
  if (!key) return false;
  const words = name.trim().split(/\s+/);
  for (let at = words.length - 2; at >= 1; at -= 1) {
    if (classifyFeeText(words.slice(at).join(" ")) === key) return true;
  }
  return false;
}

/** Pure: the rule a live fee's name and key match, without its text. */
export function nameMisreadKind(name: string, key: string | null, frequency?: string | null): { kind: SectionMisreadKind; evidence: string } | null {
  if (frontMatterName(name)) return { kind: FRONT_MATTER_NAME_REASON, evidence: name.slice(0, 60) };
  // A name composed from the advice and the next column's item ("...: Verification of Deposits") is judged by
  // the item's own words; any other advice name by its whole words. A name that still files under the live
  // category ("Use Online BillPay, HonorPay or Account-To-Account Transfers Verification of Deposits" live as
  // account_verification, 18786) names the right fee in a long name: it stays.
  const prefixed = waiverAdvicePrefix(name);
  if (prefixed) {
    const own = classifyFeeText(prefixed.item);
    if (own !== key) return { kind: WAIVER_COLUMN_NAME_REASON, evidence: `${prefixed.item.slice(0, 60)} is ${own ?? "no type"}, not ${key ?? "none"}` };
  } else if (waiverAdviceName(name) && !tailFilesUnder(name, key)) {
    const own = classifyFeeText(name);
    if (own !== key) return { kind: WAIVER_COLUMN_NAME_REASON, evidence: `${name.slice(0, 60)} is ${own ?? "no type"}, not ${key ?? "none"}` };
  }
  if (key?.startsWith("wire_") && wireServiceSubscription(name)) return { kind: WIRE_SUBSCRIPTION_REASON, evidence: name.slice(0, 80) };
  if (key === "nsf" && returnedItemServiceName(name, frequency)) return { kind: RETURNED_ITEM_SERVICE_REASON, evidence: name.slice(0, 80) };
  if (key === "monthly_maintenance" && wireServiceMonthlyName(name)) return { kind: WIRE_SERVICE_MONTHLY_REASON, evidence: name.slice(0, 80) };
  return null;
}

/** Pure: the matches among the rows the read selected, the IRA rule on each row's own text (by artifact id). */
export function findSectionMisreads(
  rows: readonly SectionMisreadRow[],
  texts: ReadonlyMap<number, string>,
): SectionMisreadFindings & { matches: SectionMisreadMatch[] } {
  const matches: SectionMisreadMatch[] = [];
  const seen = new Set<number>();
  let noText = 0;
  let cut = 0;
  let audienceUnplaced = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    if (amount == null || amount < 0) continue;
    const name = (row.fee_name ?? "").trim();
    const base = {
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount,
      canonicalFeeKey: row.canonical_fee_key,
    };
    const named = nameMisreadKind(name, row.canonical_fee_key, row.frequency);
    if (named) {
      matches.push({ ...base, kind: named.kind, reason: `${named.kind}: "${named.evidence}"` });
      continue;
    }
    if (variantCandidate(row) || cardCandidate(row)) {
      const artifactId = num(row.artifact_id);
      const text = artifactId == null ? undefined : texts.get(artifactId);
      const judged = text ? textMisreadKind(row, text) : null;
      if (judged) {
        matches.push({ ...base, kind: judged.kind, reason: `${judged.kind}: "${judged.evidence}"` });
        continue;
      }
    }
    if (returnCandidate(row) || reviewCandidate(row)) {
      const artifactId = num(row.artifact_id);
      const text = artifactId == null ? undefined : texts.get(artifactId);
      const judged = returnBesideNsfKind(row, text) ?? (text && reviewCandidate(row) ? reviewedReadKind(row, text) : null);
      if (judged) {
        matches.push({ ...base, kind: judged.kind, reason: `${judged.kind}: "${judged.evidence}"` });
        continue;
      }
    }
    const stored = storedLineMisreadKind(row.source_line, amount);
    if (stored && stored !== "cut") {
      if (stored.kind === ZERO_NOT_PRINTED_REASON) {
        const artifactId = num(row.artifact_id);
        const text = artifactId == null ? undefined : texts.get(artifactId);
        if (!text) {
          noText += 1;
          continue;
        }
        if (zeroPrintedForRead(excerptOf(row.source_line), text)) continue;
      }
      matches.push({ ...base, kind: stored.kind, reason: `${stored.kind}: "${stored.evidence}"` });
      continue;
    }
    if (stored === "cut") cut += 1;
    if (audienceCandidate(row)) {
      const artifactId = num(row.artifact_id);
      const text = artifactId == null ? undefined : texts.get(artifactId);
      const line = excerptOf(row.source_line);
      if (!text) noText += 1;
      // A stored line no line of the text holds, or more than one does, cannot be placed under a heading: unjudged.
      else if (!line || audienceRowLineCount(text, line) !== 1) audienceUnplaced += 1;
      else {
        const heading = audienceSectionHeading(text, line);
        if (heading) {
          matches.push({ ...base, kind: AUDIENCE_SECTION_UNTAGGED_REASON, reason: `${AUDIENCE_SECTION_UNTAGGED_REASON}: "${heading.slice(0, 60)}" over "${line.slice(0, 60)}"` });
          continue;
        }
      }
    }
    if (row.canonical_fee_key === "monthly_maintenance") {
      const line = excerptOf(row.source_line);
      if (!accountlessMonthlyExcerpt(line)) continue;
      // Judged on the text Knox read, as Knox judges it: a row of the page printing the fee at that price, or an
      // account heading right above the sentence, keeps the fee.
      const artifactId = num(row.artifact_id);
      const text = artifactId == null ? undefined : texts.get(artifactId);
      if (!text) {
        noText += 1;
        continue;
      }
      if (accountlessMonthlyOnPage(text, { canonicalHint: "monthly_maintenance", excerpt: line ?? "", amount })?.hold) {
        matches.push({ ...base, kind: ACCOUNTLESS_MONTHLY_REASON, reason: `${ACCOUNTLESS_MONTHLY_REASON}: "${(line ?? "").slice(0, 80)}"` });
      }
      continue;
    }
    if (row.canonical_fee_key !== "early_closure") continue;
    const artifactId = num(row.artifact_id);
    const text = artifactId == null ? undefined : texts.get(artifactId);
    if (!text) {
      noText += 1;
      continue;
    }
    if (!iraSectionClosingFee(text, name, amount, row.canonical_fee_key)) continue;
    matches.push({ ...base, kind: IRA_SECTION_CLOSING_REASON, reason: `${IRA_SECTION_CLOSING_REASON}: "${name.slice(0, 80)}" #${artifactId}` });
  }
  const byKind = emptyKinds();
  for (const match of matches) byKind[match.kind] += 1;
  return {
    checked: seen.size,
    noText,
    cut,
    audienceUnplaced,
    matched: matches.length,
    byKind,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, SECTION_MISREAD_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live flat fee whose name a rule above could match, every live flat early closure fee whose text
 * names an IRA, every live $0 with a stored line, every live fee with no product whose bank prices its name
 * otherwise and whose text could name an audience, and (version 4) every live fee whose name could be a stop
 * payment variant on a bulleted stop payment page and every live NSF fee on a fee card page, with the artifact Knox
 * read.
 */
export function sectionMisreadRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const ids = options.institutionId != null ? [options.institutionId] : null;
  const scoped = ids != null;
  const limit = Math.max(1, Math.min(options.limit ?? SECTION_MISREAD_LIMIT, SECTION_MISREAD_MAX_ROWS));
  return db<SectionMisreadRow[]>`
    WITH live AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fp.frequency, fr.extraction_note AS source_line,
             (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id,
             -- Version 3: no product, and a live fee of the same name with no product at another price.
             COALESCE(fr.product_name IS NULL AND (
               MIN(CASE WHEN fr.product_name IS NULL THEN fp.amount END) OVER sibling <> fp.amount
               OR MAX(CASE WHEN fr.product_name IS NULL THEN fp.amount END) OVER sibling <> fp.amount), false) AS audience_candidate
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount >= 0
         -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND (${!scoped} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
      WINDOW sibling AS (PARTITION BY fp.institution_id, lower(btrim(fp.fee_name)))
    ),
    named AS (
      SELECT * FROM live
       WHERE live.fee_name ~* ${WAIVER_ADVICE_NAME_SQL}
          OR live.fee_name ~* ${FRONT_MATTER_NAME_SQL}
          OR (live.canonical_fee_key LIKE 'wire\_%' AND live.fee_name ~* ${WIRE_SUBSCRIPTION_NAME_SQL})
          OR (live.canonical_fee_key = 'nsf' AND live.fee_name ~* ${RETURNED_ITEM_SERVICE_NAME_SQL})
          OR (live.canonical_fee_key = 'monthly_maintenance' AND live.source_line ~* ${ACCOUNTLESS_MONTHLY_LINE_SQL})
          OR (live.amount = 0 AND live.source_line ~ ${STORED_LINE_SQL})
          OR (live.canonical_fee_key = 'monthly_maintenance' AND live.fee_name ~* ${WIRE_MONTHLY_NAME_SQL})
    ),
    reviewed AS (
      -- Version 5: a live fee Knox v182's name review or plain-return rule could drop or re-file.
      SELECT live.* FROM live
       WHERE (live.canonical_fee_key = 'nsf' AND live.amount > 0 AND live.fee_name ~* ${PLAIN_RETURN_NAME_SQL})
          OR (live.source_line ~ ${STORED_LINE_SQL} AND (
               (live.canonical_fee_key = 'late_payment' AND live.fee_name ~* ${BOX_NAME_SQL})
            OR (live.canonical_fee_key = 'check_image' AND live.fee_name ~* ${PAPER_OFFER_SQL})
            OR (live.amount > 0 AND live.source_line ~* ${OPENING_DEPOSIT_LINE_SQL})
            OR (live.amount > 0 AND live.fee_name !~ '[a-z]' AND live.source_line ~ ${CAPS_CELL_LINE_SQL})))
    ),
    closing AS (
      SELECT live.* FROM live
        JOIN agent_source_texts a ON a.id = live.artifact_id
       WHERE live.canonical_fee_key = 'early_closure'
         AND a.normalized_text ~* ${IRA_TEXT_SQL}
    ),
    audience AS (
      SELECT live.* FROM live
        JOIN agent_source_texts a ON a.id = live.artifact_id
       WHERE live.audience_candidate
         AND NOT (COALESCE(live.canonical_fee_key, '') = ANY(${[...ACCOUNT_PRODUCT_CATEGORIES]}::text[]))
         AND live.source_line ~ ${STORED_LINE_SQL}
         AND a.normalized_text ~* ${AUDIENCE_TEXT_SQL}
    ),
    retextured AS (
      -- Version 4: a stop payment variant on a bulleted stop payment page, or an NSF fee on a fee card page.
      SELECT live.* FROM live
        JOIN agent_source_texts a ON a.id = live.artifact_id
       WHERE (COALESCE(live.canonical_fee_key, '') <> 'stop_payment'
              AND live.amount > 0
              AND live.fee_name ~* ${STOP_PAYMENT_VARIANT_NAME_SQL}
              AND live.source_line ~ ${STORED_LINE_SQL}
              AND position('•' in a.normalized_text) > 0
              AND a.normalized_text ~* ${STOP_PAYMENT_TEXT_SQL})
          OR (live.canonical_fee_key = 'nsf'
              AND a.normalized_text ~* ${FEE_CARD_TEXT_SQL}
              AND a.normalized_text ~* ${DEPOSIT_OR_CASH_TEXT_SQL})
    )
    picked AS (
      SELECT * FROM named
      UNION
      SELECT * FROM closing
      UNION
      SELECT * FROM audience
      UNION
      SELECT * FROM retextured
      UNION
      SELECT * FROM reviewed
    )
    SELECT picked.*, sib.siblings
      FROM picked
      -- Version 5: a plain return's page reads, the other live NSF and deposited item return fees from its text.
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('fee_name', other.fee_name, 'amount', other.amount, 'canonical_fee_key', other.canonical_fee_key)) AS siblings
          FROM live other
         WHERE picked.canonical_fee_key = 'nsf'
           AND other.artifact_id = picked.artifact_id
           AND other.fee_published_id <> picked.fee_published_id
           AND other.canonical_fee_key IN ('nsf', 'deposited_item_return')
      ) sib ON true
     ORDER BY picked.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Read-only: the texts Knox read, by artifact id. */
export async function sectionMisreadTexts(db: SqlTag, artifactIds: readonly number[]): Promise<Map<number, string>> {
  const texts = new Map<number, string>();
  const ids = [...new Set(artifactIds)];
  for (let start = 0; start < ids.length; start += TEXT_CHUNK) {
    const chunk = ids.slice(start, start + TEXT_CHUNK);
    const rows = await db<{ id: number | string; normalized_text: string | null }[]>`
      SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${chunk}::bigint[]) AND normalized_text IS NOT NULL
    `;
    for (const row of rows) if (row.normalized_text) texts.set(Number(row.id), row.normalized_text);
  }
  return texts;
}

function emptyResult(live: boolean, dryRun: boolean, scoped: boolean): SectionMisreadResult {
  return { live, dryRun, scoped, checked: 0, noText: 0, cut: 0, audienceUnplaced: 0, matched: 0, byKind: emptyKinds(), institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [] };
}

/** One step's re-check (see the module note). Never throws: a failed read reports nothing, and a failed write leaves the fees as they were. */
export async function recheckSectionMisreads(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<SectionMisreadResult> {
  const live = options.live ?? SECTION_MISREAD_TAKEDOWN_LIVE;
  const result = emptyResult(live, options.dryRun, options.institutionId != null);

  let rows: SectionMisreadRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => sectionMisreadRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
    const artifactIds = rows
      .filter((row) => !nameMisreadKind((row.fee_name ?? "").trim(), row.canonical_fee_key, row.frequency) &&
        (row.canonical_fee_key === "early_closure" || zeroLineCandidate(row) || audienceCandidate(row) || variantCandidate(row) || cardCandidate(row) || returnCandidate(row) || reviewCandidate(row) ||
          (row.canonical_fee_key === "monthly_maintenance" && accountlessMonthlyExcerpt(excerptOf(row.source_line)) != null)))
      .map((row) => num(row.artifact_id))
      .filter((id): id is number => id != null);
    texts = await inSavepoint(db, (scope) => sectionMisreadTexts(scope, artifactIds));
  } catch (error) {
    console.warn("[darwin] section misread check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findSectionMisreads(rows, texts);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: SECTION_MISREAD_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${SECTION_MISREAD_CHECK}, 'completed',
          ${`Read live fees named or filed by another part of the page or a held read's words: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s) (${SECTION_MISREAD_REASONS.map((kind) => `${result.byKind[kind]} ${kind}`).join(", ")}); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(sectionMisreadDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] section misread check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the reason's flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: SectionMisreadMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-section-misread-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      for (const kind of SECTION_MISREAD_REASONS) {
        const verified = fees.filter((fee) => fee.kind === kind && ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length === 0) continue;
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${kind} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${kind}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] section misread takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: SectionMisreadMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.section_misread_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) named or filed by another part of the page, on their second look`},
        ${JSON.stringify({ version: SECTION_MISREAD_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] section misread takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: SectionMisreadMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    kind: fee.kind,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function sectionMisreadDetail(result: SectionMisreadResult) {
  return {
    check: SECTION_MISREAD_CHECK,
    version: SECTION_MISREAD_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    no_text: result.noText,
    cut_line: result.cut,
    audience_unplaced: result.audienceUnplaced,
    matched: result.matched,
    by_kind: result.byKind,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
