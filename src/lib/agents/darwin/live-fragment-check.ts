import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import {
  LIVE_FRAGMENT_REGEXES,
  feeOfSentenceTail,
  gluedReadable,
  gluedSentenceSplit,
  writeLiveRenames,
  type RetidyRename,
} from "@/lib/agents/knox/name-retidy";
import { liveFragmentName, liveFragmentShape, type LiveFragmentPattern } from "@/lib/fee-name-fragments";
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
 * - Everything else is a `takedown`, as before. v5: except a `sentence_end` line with no rename,
 *   which is a `reread` (below).
 *
 * v5 (#1499, after a prod check of v5: 20 of 22 sampled `sentence_end` takedowns were real,
 * correctly priced fees): a `sentence_end` line that gets no rename is never taken down. Its action
 * is `reread`: the fee stays live and, with the switch on, the step only writes the
 * `LIVE_FRAGMENT_REREAD_KIND` row asking Knox to read its line again (#1511). `pronoun` and
 * `trailing_range` fragments and `rename_duplicate` still come down, as does a `sentence_end` line at
 * $0, with no amount or with waiver wording (a waived price: 5314's "... reduce your monthly fee to"
 * $0, #1436), with no re-read request.
 *
 * v6 (#1499, after a prod check of v5): `pronoun` lines are kept live the same way, and a line
 * comes down only at $0 or no amount, on a credit or discount amount, when it is no fee of this
 * bank, or when a gate refused its amount (with a re-read request). Waiver wording alone no longer
 * takes a priced fee down; it bars a rename only. See `liveFragmentVerdictDetail` and darwin/AGENTS.md.
 *
 * v6 round 4 (#1499, review rev10 and prod r10): conservative by default, so a gap fails safe to
 * `reread`. A line comes down only at $0 or no amount, on a credit equal to the amount, when it
 * opens on another bank's charge or a worked example, or when a gate refused the amount at $100 or
 * more (`liveFragmentSoft`: under $100 every refusal is a `reread`). A head renames only when the
 * rest carries none of `LIVE_FRAGMENT_RENAME_BAR` or is one of three narrow forms (balance below,
 * dormancy tier, a duration the head names); a tail only when the whole line passes the bar; and the
 * target must name a fee, with no figure and no sentence opener.
 *
 * v6 round 5 (#1499, review rev11): head and tail renames are allowlists (`LIVE_FRAGMENT_CHARGE_SENTENCE`,
 * `LIVE_FRAGMENT_TAIL_LEAD`); the balance form renames only under $25; credits are an allowlist;
 * "no fee of this bank" counts only at the start of the line; a "$" figure equal to the amount
 * refuses only after a threshold word; a waived trailing range is a `reread`.
 *
 * v6 round 6 (#1499, review rev12): tail leads carry their own subject and a reduced tail phrase is
 * no rename; an if/when clause with no balance or threshold word, and a floor, are rereads, never
 * takedowns; a bare cents figure reads like "$"; a credit beside the same price is the fee; another
 * bank's charge comes down only with no fee word; the count SQL reads no-break spaces as spaces.
 *
 * v6 round 8 (139153, still v6): a closing "account you have at <bank>" clause renames to its head
 * at any amount, $0 included (`LIVE_FRAGMENT_OWN_ACCOUNT`, `liveFragmentOwnAccountHead`).
 *
 * v6 round 7 (#1521, review of bf43365e, still v6 in shadow): only moves takedowns and renames to
 * rereads. An if/when comparative is a threshold only before a money figure or "balance"; the credit
 * guard reads a bare cents price; credit words are whole words and no product noun; a credit after a
 * fee head with no price of its own is a `reread`; a tail rename never on a line cut at its start; the
 * SQL reads U+FEFF (and, in `liveNamesFor`, the no-break spaces) as spaces. A floor beside a cap and
 * "$N minimum balance" read as a floor are left as they are (closing them adds takedowns).
 *
 * v2 (#1499, after a prod hand-check of v1): the head is read wider for `sentence_end` names and
 * generic or clause heads are refused (see `gluedSentenceHead`); a name that speaks of a minimum or
 * opening deposit is never renamed (`LIVE_FRAGMENT_OPENING_DEPOSIT`: its price is the deposit). A
 * `sentence_end` fragment that still comes down is usually a real fee whose line Knox read badly,
 * so with the switch on its takedown also writes a `pipeline_feedback` row of kind
 * `LIVE_FRAGMENT_REREAD_KIND` asking Knox to read its source line again; the row records the
 * request and where the line is (#1499). Knox reads it in `knox/reread-feedback.ts` (#1511).
 */
export const LIVE_FRAGMENT_CHECK = "darwin.live_fragment_check";
/**
 * Takedown switch, on (James's yes, 2026-10-17, after the whole-table dry run by pattern from
 * `countLiveFragmentNames`). Set to false and the pass only reports.
 */
export const FRAGMENT_NAME_TAKEDOWN_LIVE = true;
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
 * is not another price; "2FA-" and "2FA:" are no footnote. v5 (#1499, after a prod hand-check of
 * v4: 101 of 105 renames right): "may therefore" anywhere is total wording; "Per quarter charge"
 * and a bare "Activation fee" are generic; "only if" and "if your ... balance falls below" reach
 * the balance gate; a generic head ("Monthly Fee", "Service charge") renames on a balance-below
 * condition only; the figure gate reads the name after its glued footnote and skips a bare count
 * ("6 debits"). v6 (#1499, after a prod check of v5): a pronoun or sentence_end line comes down
 * only at $0 or no amount, on a credit or discount amount, when it is no fee of this bank, or when
 * a gate refused the amount; every other unnamed line is a `reread` kept live. Waiver wording alone
 * no longer takes a priced fee down but still bars every rename; cap words refuse the amount; a
 * line ending on a threshold ("balance of", "more than", "below" at $100 or more) refuses it before
 * any rename; "account falls below" is a balance condition; a fee head before ":" or a dash renames
 * over an if/when clause with the balance gate's bars; a balance band is no threshold; a threshold
 * dollar is no second price; an all-capitals line ending on a verb and "A" is a sentence_end.
 * Round 4 (still v6, shadow): the rename bar, the three narrow head forms, the target checks, the
 * one soft check for every refusal and the sentence-start reading of "no fee of this bank".
 * v7 (#1521): a name cut before its noun, after a count and an audience word ("Counter Check: A
 * blank page of 3 personal", 75914; "... Daily fee after 5 business", 74142), is a `sentence_end`
 * (`DANGLING_AUDIENCE` in the shared shape). Both live matches on 2026-10-25 are rereads kept live.
 */
export const LIVE_FRAGMENT_STRATEGY = { strategy: LIVE_FRAGMENT_CHECK, version: 7 } as const;
/**
 * Waiver or discount wording: a name that says the price is waived or cut is a waived price, never
 * renamed. v6 (#1499 review): it bars a rename only; a waived line at a positive amount is kept live
 * for a re-read (`reread`), never taken down for the wording alone.
 */
export const LIVE_FRAGMENT_WAIVE_WORDING = /\b(?:waiv(?:e|ed|er|ers|es|ing)|discount(?:s|ed)?|rebates?|reduc(?:e|ed|es|tion)|avoid(?:ed|s)?|no charge)\b/i;
/**
 * v2 (#1499): a minimum or opening deposit named in the line: the price is the deposit, never a
 * fee, so the name is never renamed ("ATM5, Telephone Banking and Bill Payment" $20, 77786).
 */
export const LIVE_FRAGMENT_OPENING_DEPOSIT = /\b(?:minimum|min|opening|initial)\s+(?:(?:opening|initial)\s+)?deposits?\b|\bdeposits?\s+to\s+open\b/i;
/**
 * v2 (#1499): the `pipeline_feedback` kind a `sentence_end` takedown (v5: `reread`, the fee kept live) writes: Knox, read this fee's
 * source line again so the real fee can come back under a proper name. Knox's
 * `consumeRereadRequests` (`knox/reread-feedback.ts`, #1511) reads it.
 */
export const LIVE_FRAGMENT_REREAD_KIND = "knox_reread_requested";
/** v5 (#1499): the re-read evidence reason for a `reread` fee kept live (a takedown keeps its `fragment name:` reason). */
export const LIVE_FRAGMENT_KEPT_REASON = "kept live: sentence_end with no name";
/** v6: the kept-live reason for any pattern (`pronoun` lines are kept live too). */
export const liveFragmentKeptReason = (pattern: LiveFragmentPattern) => `kept live: ${pattern} with no name`;
/**
 * v3 (#1499): the rest of a line opens with an "if" or "when" condition (either case). v5: "only
 * if" / "only when" too (132041). v6 round 4: such a head renames only through one of the narrow
 * forms below (`LIVE_FRAGMENT_BALANCE_FORM`, `LIVE_FRAGMENT_TIER_CONDITION`,
 * `LIVE_FRAGMENT_DURATION_FORM`); any other if/when clause is a `reread`.
 */
export const LIVE_FRAGMENT_IF_CONDITION = /^\s*(?:[|:.;–—-]\s*)?(?:only\s+)?(?:if|when)\b/i;
/**
 * v6 round 4 (#1499): the one balance condition a head still renames over, the whole rest of the
 * line: "if the (average daily) balance falls below", "if Account Falls Below (Minimum Balance of)"
 * (96650-96652, 136152), "when balance falls below", under `LIVE_FRAGMENT_CONDITION_MAX` with no
 * figure equal to the amount and a head ending on "fee" or "charge". 13 of 14 such rows on prod were
 * the fee ($2 to $15 against thresholds of $50 to $5,000). A generic head ("Monthly Fee") takes it
 * only when the line does not end on "balance of".
 */
export const LIVE_FRAGMENT_BALANCE_FORM = /^\s*(?:[|:.;–—-]\s*)?(?:only\s+)?(?:if|when)\s+(?:(?:the|your)\s+)?(?:(?:average|avg|daily|minimum|ledger|collected)\s+)*(?:balances?|accounts?)\s+(?:(?:falls?|drops?|goes|is)\s+)?(?:below|under|less\s+than)(?:\s+(?:the\s+)?(?:required\s+)?minimum(?:\s+daily)?\s+balance(?:\s+of)?)?\s*$/i;
export const LIVE_FRAGMENT_CONDITION_MAX = 100;
/**
 * v4 (#1499): a dormancy tier after a cell break is the fee's condition, not a threshold read as
 * the amount ("Inactive Accounts Fee (cont.) | If more than 3 years dormant the fee is" $15, 44880).
 * v6 round 4: the whole rest of the line, with the balance form's bars.
 */
export const LIVE_FRAGMENT_TIER_CONDITION = /^\s*\|\s*if\s+(?:(?:more\s+than|over)\s+\d+\s+(?:years?|months?|days?)\s+)?(?:dormant|inactive|inactivity)(?:\s+for\s+\d+\s+(?:years?|months?|days?))?(?:\s+the\s+fee\s+is)?\s*$/i;
/**
 * v6 round 4 (146643, 146563): a duration condition ("If your account remains overdrawn for more
 * than 10 business days, a") renames only when the head itself names the duration fee
 * ("Continuous Overdraft Charge", "Inactivity Fee"), with the balance form's bars.
 */
export const LIVE_FRAGMENT_DURATION_HEAD = /\b(?:continuous|sustained|extended|consecutive|daily|inactiv\w*|dorman\w*)\b/i;
export const LIVE_FRAGMENT_DURATION_FORM = /^\s*(?:[|:.;–—-]\s*)?(?:only\s+)?(?:if|when)\s+(?:(?:the|your)\s+)?(?:account\s+)?(?:(?:is|has\s+been|has|remains|stays)\s+)?(?:no\s+activity|inactive|dormant|overdrawn|negative)\s+(?:for\s+)?(?:(?:more\s+than|over)\s+)?\d+\s+(?:(?:business|calendar|consecutive)\s+)?(?:days?|months?|years?)(?:,?\s+(?:the|an?|the\s+fee\s+is|an?\s+(?:monthly\s+)?(?:inactivity|dormant|dormancy|continuous\s+overdraft)\s+(?:fee|charge)\s+of))?\s*$/i;
/**
 * v6 round 4 (#1499): a rename needs the rest of the line (the whole line, for a `tail`) to carry no
 * condition, person, segment or price-variation wording at all, and no digit or "$". Anything this
 * reads is a `reread`, so a gap in it fails safe. "over" counts only before a figure or a number
 * word ("over the phone" is no condition, 85002).
 */
export const LIVE_FRAGMENT_RENAME_BAR = /\b(?:if|when|whenever|unless|without|except|after|before|until|once|you|your|we|our|additional|subsequent|increas\w*|sustained|continuous|consecutive|smaller|lower\w*|half|reduc\w*|de\s+minimis|tier\w*|seniors?|students?|aged?|older|younger|under|over(?=\s*(?:\$|\d|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred)\b))|below|above|more|less|least|fewer|exceed\w*|beyond|max|maximum|min|minimum|cap|caps|capped|up\s+to|per\s+day|daily|[a-z]+er\s+than|in\s+excess|keeps?|within|(?:non-?)?members?|customers?)\b|[0-9$]/i;
/**
 * v6 round 5 (#1499, rev11): the head rename is an allowlist. Besides the three narrow forms, a head
 * renames only when the rest of the line, after an optional separator, is one short "this is the
 * charge" sentence and nothing else ("You will be charged", "is assessed per item", "This fee is
 * charged for each item", a bare "You will"). Anything else ("This fee is not charged on overdrafts
 * of", "The fee for business accounts is", "There is no fee for") is a `reread`.
 */
export const LIVE_FRAGMENT_CHARGE_SENTENCE = /^\s*(?:[.:;|–—-]\s*)?(?:(?:you\s+will\s+be|you['’]ll\s+be|will\s+be|is|are)\s+(?:charged|assessed|imposed)(?:\s+(?:a|an|the|per\s+item|per\s+check|per\s+request|each|for\s+each\s+(?:item|check|request|transfer|occurrence)|per\s+occurrence))?|this\s+(?:fee|charge)\s+(?:is|will\s+be)\s+(?:charged|assessed)(?:\s+(?:per\s+item|for\s+each\s+item))?|you\s+will|you['’]ll)\s*$/i;
/**
 * v6 round 5 (#1499, rev11): the tail rename is an allowlist too. Everything before the fee phrase is
 * a bare charge clause ("you will be charged an", "are assessed a"); any subject before it ("Business
 * accounts are charged", "Second and later items are charged") is a `reread`. What follows the
 * clause still passes `LIVE_FRAGMENT_RENAME_BAR`. Round 6 (rev12): only a lead with its own subject
 * ("you will be", "you'll be", "accounts are"); a bare "are charged a" or "will be charged a" was cut
 * from its subject and is a `reread`.
 */
export const LIVE_FRAGMENT_TAIL_LEAD = /^\s*(?:you\s+will\s+be|you['’]ll\s+be|accounts\s+are)\s+(?:charged|assessed)\s+an?\s+/i;
/**
 * v6 round 6 (#1499, rev12): a tail phrase that reads as a reduced price ("a small overdraft fee of",
 * "a low balance fee of") is no rename. Read on the raw phrase after the lead, before Knox's tail
 * qualifiers are stripped. Darwin only; Knox's tail reading is unchanged.
 */
export const LIVE_FRAGMENT_TAIL_REDUCED = /\b(?:small|low|minimal|nominal|lesser|partial|reduced|discounted)\b/i;
/**
 * v6 round 6 (#1499, rev12): a refused if/when clause takes a line down (at $100 or more) only when it
 * speaks of a balance or threshold or a figure in the line is the amount; otherwise ("Safe Deposit
 * Box Drilling Fee If keys are lost, you will be charged" $150) it is a `reread`.
 * Round 7 (#1521): a comparative counts only when a "$" figure, a figure with cents or "balance"
 * follows it (through "than", "of", articles and balance qualifiers); "minimum" and "maximum" still
 * count on their own ("falls below the minimum"). A count, a duration or legal
 * wording is no money threshold: "If we are served under a court order", "If more than one order is
 * received", "If research exceeds one hour", "If the account is inactive for more than 12 months" are
 * rereads at $100 too. A bare "balance" with no comparative before it no longer counts either.
 */
export const LIVE_FRAGMENT_IF_THRESHOLD_WORD = /\b(?:minimum|maximum)\b|\b(?:below|under|less|more|over|above|exceed\w*|least|greater)\s+(?:(?:than|of|to|the|your|a|an|required|minimum|daily|average|avg|ledger|collected|account)\s+)*(?:\$|\d[\d,]*\.\d{2}\b|balances?\b)/i;
/** v6 round 5 (rev11): the balance-below form renames only under this amount ($25 and up is a `reread`). */
export const LIVE_FRAGMENT_BALANCE_MAX = 25;
/** v6 round 4: a rename target never carries a price or a count (C). */
export const LIVE_FRAGMENT_PRICE_IN_NAME = /[0-9$]/;
/**
 * v6 round 4 (64675 "Also, the order" $32.98): a rename target names a fee: it holds a fee noun or a
 * known fee product noun, and does not open on a sentence opener. Otherwise `reread`.
 */
export const LIVE_FRAGMENT_FEE_NOUN = /\b(?:fees?|charges?|penalt(?:y|ies)|assessments?|overdrafts?|nsf|stop\s+payments?|wires?|cashier'?s\s+checks?|money\s+orders?|safe\s+deposit|research|photocop(?:y|ies)|statements?|returned\s+items?|return\s+items?|levy|levies|garnishments?)\b/i;
/** Also after a dash inside the target ("Overdraft Fee - this fee"): the head ran into the sentence. */
export const LIVE_FRAGMENT_SENTENCE_OPENER = /(?:^|\s[–—-]\s*)(?:also|the|however|please|if|when|this|that|these|a|an)\b/i;
export const LIVE_FRAGMENT_FEE_HEAD = /\b(?:fees?|charges?)$/i;
/**
 * v6 round 8 (139153, still v6): a fee name whose only pronoun is a closing "account you have at
 * <bank>" clause is no fragment. "Overdraft Protection Automatic Transfer from Another Deposit
 * Account you have at MSCU1" is listed "Free" on the bank's schedule: a real $0 price (rule 3), so
 * it renames to the head (group 1) and stays live, at any amount, never coming down. The clause is
 * the whole rest of the line: an optional "that"/"which", you have/hold/own/maintain, at or with,
 * then "us" or up to four capitalised words (the bank's name), with an optional footnote digit.
 */
export const LIVE_FRAGMENT_OWN_ACCOUNT = /^(.*\b(?:[Aa]ccounts?|[Ll]oans?|[Cc]ards?|[Ll]ine of [Cc]redit))\s+(?:that\s+|which\s+)?[Yy]ou\s+(?:have|hold|own|maintain)\s+(?:at|with)\s+(?:us|[A-Z][A-Za-z&.-]*(?:\s+[A-Z][A-Za-z&.-]*){0,3})\d{0,2}$/;
/**
 * v4 (#1499): wording that totals several charges ("users may therefore incur $45 in NSF fees",
 * "a total of"): the amount is a sum, never renamed (55708). v5: "may therefore" anywhere, since a
 * stored name can be cut just after it ("... you may therefore", 55708 again).
 */
export const LIVE_FRAGMENT_TOTAL_WORDING = /\b(?:may\s+therefore|incur\s+\$\s?\d[\d,]*(?:\.\d{1,2})?\s+in|in\s+(?:[A-Za-z'’/-]+\s+){0,3}fees?\s+for\s+one|a\s+total\s+of)\b/i;
/**
 * v6 (#1499): the amount is a credit or discount, not a fee ("$2.50 credit", "reduced by $2",
 * "discount of $2", "−$2", 87742): the line comes down. "$10 credit card", "credit union", "credit
 * line", "credit limit" and "credit report" are no credit. A negative figure counts only when it
 * stands alone: a minus sign (U+2212) at the start or after a space, or a minus or hyphen inside a
 * parenthesis ("(-$5)"). A hyphen after a word or a name is a separator ("Wire Fee -$25"), and one
 * at the start of the line is a bullet ("-$5.00 per statement"), so neither is a credit. v6 (review
 * 9): the credit's figure must be the amount ("..., $2 credit with e-statements" at $10 is the fee),
 * and "credit check", "credit inquiry" and "credit bureau" are no credit. The figures are groups 1-6.
 * Round 5 (rev11): an allowlist. Only "credit of $N", "$N credit to/on/applied to your account or
 * statement", "(-$N)" or "(−$N)" standing alone in parentheses, "reduced by $N" and "discount of $N"
 * are credits; a bare "$N credit <noun>" or a minus sign after a head is a `reread`. Groups 1-5.
 */
export const LIVE_FRAGMENT_CREDIT = /\bcredit\s+of\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s+credit\s+(?:to|on|applied\s+to)\s+your\s+(?:account|statement)\b|\(\s*[-−]\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*\)|\breduced\s+by\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\bdiscount\s+of\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
/** v6 (review 9): the line states a credit or discount whose figure is the amount (`LIVE_FRAGMENT_CREDIT`). */
export function liveFragmentCredit(name: string, amount: number): boolean {
  const credited = [...name.matchAll(new RegExp(LIVE_FRAGMENT_CREDIT.source, "gi"))].some((match) => {
    const figure = match.slice(1).find((group) => group != null);
    // Round 6 (rev12): a bare "(-$35)" counts only on a line that speaks of a credit, discount, rebate or refund.
    if (match[3] != null && !LIVE_FRAGMENT_CREDIT_WORD.test(name)) return false;
    return figure != null && Math.abs(figureValue(figure) - amount) < 0.005;
  });
  // Round 6 (rev12): a dollar figure outside the credit phrase that is the amount is the fee's own price
  // ("Paper Statement Fee $3.00 per month; you will receive a credit of $3.00 if you" $3): no takedown.
  // Round 7 (#1521): a bare figure with cents ("Paper Statement Fee 3.00 per month; ...") is the price too.
  return credited && ![...name.replace(new RegExp(LIVE_FRAGMENT_CREDIT.source, "gi"), " ").matchAll(LIVE_FRAGMENT_OWN_PRICE)].some((match) => Math.abs(figureValue(match[1] ?? match[2]) - amount) < 0.005);
}
/**
 * Round 7 (#1521): the credit guard's own-price read: a "$" figure (group 1) or a bare figure with
 * cents ("3.00", group 2).
 */
export const LIVE_FRAGMENT_OWN_PRICE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*\.\d{2})\b/g;
/**
 * Round 6 (rev12): the wording a bare "(-$N)" needs to count as a credit. Round 7 (#1521): a whole word
 * ("creditor" is none), and never a product or institution noun: "credit union", "Credit Card",
 * "credit line" or "Discount Brokerage" is no credit.
 */
export const LIVE_FRAGMENT_CREDIT_WORD = /\b(?:credit(?:s|ed)?|discount(?:s|ed)?|rebates?|refund(?:s|ed)?)\b(?!\s+(?:unions?|cards?|lines?|limits?|reports?|checks?|inquir(?:y|ies)|bureaus?|scores?|builder|brokerage|broker)\b)/i;
/**
 * Round 7 (#1521): a credit line with no price of its own: before its first credit phrase it names a
 * fee, then breaks the cell or clause (a "|", ";", ":", ",", a dash or a spaced hyphen: "Paper Statement
 * Fee | credit of $3.00 if you", "Paper Statement Fee; e-statement credit of $2 if you"), and states no price before the credit. The fee's own price
 * was cut, so the amount may be it: the line is a `reread`, never a takedown.
 */
export const LIVE_FRAGMENT_CREDIT_HEAD = /\b(?:fees?|charges?)\b.*(?:[|;:,–—]|\s-\s)/i;
/** Round 7 (#1521): the line before its first credit phrase names a fee and no price (`LIVE_FRAGMENT_CREDIT_HEAD`). */
export function liveFragmentCreditHeaded(name: string): boolean {
  const at = name.search(new RegExp(LIVE_FRAGMENT_CREDIT.source, "i"));
  if (at < 0) return false;
  const before = name.slice(0, at);
  return LIVE_FRAGMENT_CREDIT_HEAD.test(before) && !new RegExp(LIVE_FRAGMENT_OWN_PRICE.source).test(before);
}
/**
 * v6 (#1499): no fee of this bank at all: a worked example ("For example, if ...", "Example:",
 * "... Because the transact", 95216) or another bank's charge ("Bank sending the wire will
 * typically charge", 142713). Comes down. A bare "example" ("certain items, for example stop
 * payments") and "typically charges" are left alone: the line is still this bank's fee. v6 (review
 * 9): "Because the transact..." only after a sentence break or at the start. Round 4: every marker
 * only at the start of the line or of a sentence (`liveFragmentNotAFee`).
 */
export const LIVE_FRAGMENT_NOT_A_FEE = /^\s*(?:for\s+example,?\s+if\b|example:|because\s+the\s+transact\w*)/i;
/** v6 round 6 (rev12): another bank's charge at the start of the line; a takedown only with no fee or charge word on the line. */
export const LIVE_FRAGMENT_OTHER_BANK = /^\s*(?:the\s+)?(?:bank\s+sending|sending\s+bank)\b/i;
/**
 * v6 round 5 (#1499, rev11): the worked example or other bank's charge opens the line itself. A
 * marker anywhere else ("Incoming Domestic Wire. The sending bank may charge you" $15) is a `reread`.
 */
export function liveFragmentNotAFee(name: string): boolean {
  return LIVE_FRAGMENT_NOT_A_FEE.test(name) || (LIVE_FRAGMENT_OTHER_BANK.test(name) && !LIVE_FRAGMENT_FEE_WORD.test(name));
}
/**
 * v6 (#1499): a cap or floor states a limit, not the fee's price ("maximum late charge of" $30,
 * "min or 1% with max of" $25, "Greater of" $10, "capped at" $105): the amount is refused. "Max",
 * "maximum" and "cap" count only before "of $" (or "of" ending the line, where the cut-off "$"
 * would be), a dollar figure, or a charge or fee word, so "Max Checking", "MAX CHECKING MONTHLY FEE"
 * and "maximum of 3 per day" are no cap.
 */
export const LIVE_FRAGMENT_CAP_WORDING = /\b(?:max(?:imum)?|cap)\s+(?:of\s+\$|of\s*$|\$\s?\d|(?:(?:late|monthly|daily|overdraft|od|nsf)\s+)?(?:charges?|fees?)\b)|\b(?:capped|lesser\s+of)\b/i;
/**
 * v6 round 6 (#1499, rev12): a floor ("greater of", "minimum charge", "min or", "whichever is
 * greater", "$100 minimum") states the least the fee can be, so the amount may well be the fee: the
 * line is a `reread`, never a takedown and never a rename. Caps (`LIVE_FRAGMENT_CAP_WORDING`) stay hard.
 */
export const LIVE_FRAGMENT_FLOOR_WORDING = /\b(?:greater\s+of|minimum\s+charge|min\s+or|whichever\s+is\s+greater)\b|\$\s?\d[\d,]*(?:\.\d{1,2})?\s+minimum\b/i;
/**
 * v6 (133104): a line that ends on a balance ("Avoid service charge with minimum balance of" $3,
 * "You may avoid the fee if your balance is" $1,000) read the threshold as its amount: refused
 * before any rename.
 */
export const LIVE_FRAGMENT_THRESHOLD_END = /\bbalances?\s+(?:of|is)\s*$/i;
/**
 * v6 (#1499 review): a line that ends on a count or time threshold ("if more than" 6, "when
 * overdrawn by more than" $5, "if inactive for" 12) read the threshold as its amount: refused,
 * head or no head.
 */
export const LIVE_FRAGMENT_EXCESS_END = /\b(?:more\s+than|greater\s+than|over|above|at\s+least|exceed(?:s|ing)?|in\s+excess\s+of|inactive\s+for)\s*$/i;
/**
 * v6 (#1499 review): a line that ends on "below", "under" or "less than" at $100 or more read the
 * balance threshold as its amount (the balance gate's own cap, `LIVE_FRAGMENT_CONDITION_MAX`).
 */
export const LIVE_FRAGMENT_BELOW_END = /\b(?:below|under|less\s+than)\s*$/i;
/**
 * v6 (review 9): a glued sentence after a head that states a condition ("You will be charged unless
 * your balance is at least", "... after 12 months", "... for items exceeding", "... in excess of",
 * "... unless you keep", "... per item over the limit", "... older than", or a clause ending on
 * below, under, by, within or before) is the fee's threshold, not its name: the head is no rename.
 */
export const LIVE_FRAGMENT_REST_CONDITION = /\b(?:unless|after|exceed\w*|above|over|less\s+than|[a-z]+er\s+than|at\s+least|in\s+excess\s+of|keeps?)\b|\b(?:below|under|by|within|before)\s*$/i;
/** v6 (review 9): a reduced price ("a lower fee of", "will be lowered to", "half of"): bars a rename like waiver wording. */
export const LIVE_FRAGMENT_REDUCED_WORDING = /\b(?:lower(?:ed|s)?|half)\b/i;
/**
 * v6 (review 9): Darwin's own all-capitals article fragment ("... WCDU, THERE IS A", 109893): a
 * verb or function word and " A", " AN" or " THE". Only this check reads it; Knox's
 * `liveFragmentName`, which the public fee name uses, is unchanged, so "WIRE FEE FOR THE" and
 * "SERVICE CHARGE A" display as stored. Bare "CHARGE" and "PAY" are left out.
 */
export const LIVE_FRAGMENT_CAPS_ARTICLE = /^[^a-z]*\s(?:IS|OF|FOR|TO|WITH|BE|BY|CHARGE[DS]|ASSESS(?:ED)?|INCUR)\s(?:A|AN|THE)$/;
/** The shape this check reads: Knox's, with `LIVE_FRAGMENT_CAPS_ARTICLE` as a `sentence_end` ahead of `pronoun`. */
export function liveFragmentCheckShape(name: string | null | undefined): LiveFragmentPattern | null {
  const shape = liveFragmentShape(name);
  if (shape === "plus" || shape === "trailing_range" || shape === "sentence_end") return shape;
  return LIVE_FRAGMENT_CAPS_ARTICLE.test((name ?? "").replace(/\s+/g, " ").trim()) ? "sentence_end" : shape;
}
/** v6 (129443): a balance band ("more than or equal to but less than") is the fee's own tier. */
export const LIVE_FRAGMENT_BAND_CONDITION = /\b(?:more|greater)\s+than\s+or\s+equal\s+to\b.*\b(?:less\s+than|below|under)\s*$/i;
/**
 * v3 (#1499): a price stated in the name with a fee word after it ("a $35 Overdraft Fee", "$45 in
 * NSF fees"); group 1 is the figure. Two of them, or one that is not the fee's amount, mean the
 * line holds another fee's price and is never renamed (133792, 55708). v6 (37674): the words between
 * the figure and the fee word are never "if", "when", "unless", "not" or "or" ("$2,500 if not fee
 * will be charged" states a balance, not a priced fee).
 */
export const LIVE_FRAGMENT_PRICED_FEE = new RegExp(String.raw`\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s+(?:(?!(?:if|when|unless|not|or)\b)[A-Za-z'’/-]+\s+){0,3}(?:fees?|charges?)\b`, "gi");
/**
 * v3: any dollar figure; one that is not the amount blocks a rename unless the line is about a
 * balance ("below $500"). v4: a figure a threshold word leads into ("more than $5", "under $500")
 * is a threshold, not another price (`LIVE_FRAGMENT_THRESHOLD_DOLLAR`, removed before the read).
 * Comparison words only: "up to", "at least", "a minimum of" state a price on a fee line.
 */
export const LIVE_FRAGMENT_DOLLAR = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
const LIVE_FRAGMENT_DOLLAR_FIRST = new RegExp(LIVE_FRAGMENT_DOLLAR.source);
export const LIVE_FRAGMENT_THRESHOLD_DOLLAR = /\b(?:(?:more|less|greater|fewer)\s+than|below|under|over|above|exceeds?|exceeding|in\s+excess\s+of)\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)/gi;
/**
 * v6 round 6 (#1499, rev12): the figure gate's threshold read: a "$" figure, or a bare figure with
 * cents ("100.00"), that a threshold word leads into. Group 1 or 2 is the figure.
 */
export const LIVE_FRAGMENT_THRESHOLD_FIGURE = /\b(?:(?:more|less|greater|fewer)\s+than|below|under|over|above|exceeds?|exceeding|in\s+excess\s+of)\s+(?:\$\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*\.\d{2})\b)/gi;
const LIVE_FRAGMENT_BALANCE_WORD = /\bbalances?\b/i;

/**
 * v6 (#1499 review): true when the whole line ends on a threshold, so the amount is the threshold
 * and not the fee: "... balance of" / "... balance is", "more than", "over", "inactive for", or
 * "below", "under", "less than" at `LIVE_FRAGMENT_CONDITION_MAX` or more. Round 4: a refusal like
 * every other gate's (`liveFragmentSoft` decides between `reread` and takedown).
 */
export function liveFragmentThresholdEnd(name: string, amount: number): boolean {
  return LIVE_FRAGMENT_THRESHOLD_END.test(name) || LIVE_FRAGMENT_EXCESS_END.test(name)
    || (amount >= LIVE_FRAGMENT_CONDITION_MAX && LIVE_FRAGMENT_BELOW_END.test(name));
}

/**
 * v6 round 4 (#1499, prod r10): the one soft check every refusal goes through. Under
 * `LIVE_FRAGMENT_CONDITION_MAX` a refused amount is most likely the fee itself, so the line is kept
 * live (`reread`, never renamed): 35202 "Overdraft Fee for each item we pay that overdraws your
 * account more than" $35, and 106716 "Cashier's Check (to third party) greater than" $10 (no fee word;
 * the source reads "greater than $500 $10.00 per check"). At $100 or more a refusal takes the line down.
 */
export function liveFragmentSoft(_name: string, amount: number): boolean {
  return amount < LIVE_FRAGMENT_CONDITION_MAX;
}

/** v6 (125163, 125166): the readable line opens in lower case, so it was cut at its start. */
export const LIVE_FRAGMENT_CUT_START = /^[a-z]/;
/**
 * v6 (prod r9): on a line cut at its start, a head of period and service words only ("monthly
 * service charge", "per monthly fee", 125163, 125166) is no rename: the cut-off text held the price.
 * Other lower-case heads ("monthly maintenance fee if ...") still rename.
 */
export const LIVE_FRAGMENT_CUT_GENERIC_HEAD = /^(?:(?:per|monthly|quarterly|annual|yearly|service)\s+)*(?:fees?|charges?)$/i;
/** v6 (prod r9): a head that opens on "per" ("Per quarter charge", 64144) is a period, not a name: no rename. */
export const LIVE_FRAGMENT_PER_HEAD = /^per\b/i;
/**
 * v6 (review 9): a dollar figure a cap or floor word leads into ("maximum of $105", "capped at $90",
 * "minimum charge $5"): the cap's own figure, not a price the line states.
 */
export const LIVE_FRAGMENT_CAP_DOLLAR = /\b(?:max(?:imum)?|cap(?:ped)?|greater|lesser|minimum|min)\b(?:\s+(?:of|at|charge|fee))*\s+\$\s?\d[\d,]*(?:\.\d{1,2})?/gi;
/**
 * v6 (review 9): cap wording refuses the amount only when the line states no dollar price equal to
 * the amount outside the cap's own figure ("Research Fee $25 per hour, minimum charge one hour" at $25
 * and "Overdraft fee $30 per item. Maximum daily fees" at $30 are the fee).
 */
export function liveFragmentCapRefused(name: string, amount: number): boolean {
  if (!LIVE_FRAGMENT_CAP_WORDING.test(name)) return false;
  return ![...name.replace(LIVE_FRAGMENT_CAP_DOLLAR, " ").matchAll(LIVE_FRAGMENT_DOLLAR)].some((match) => Math.abs(figureValue(match[1]) - amount) < 0.005);
}
/**
 * v6 (review 9): the line with its thresholds and its credit or discount phrases left out, for the
 * price reads. Round 4 (B1): a cap's own dollar figure (`LIVE_FRAGMENT_CAP_DOLLAR`) too.
 */
function priceReadable(name: string): string {
  return name.replace(LIVE_FRAGMENT_THRESHOLD_DOLLAR, " ").replace(new RegExp(LIVE_FRAGMENT_CREDIT.source, "gi"), " ").replace(LIVE_FRAGMENT_CAP_DOLLAR, " ");
}
/** A fee or charge word anywhere in the line. */
export const LIVE_FRAGMENT_FEE_WORD = /\b(?:fees?|charges?)\b/i;
/**
 * v6 (125163, 125166): the line states two or more dollar prices (thresholds left out), the first
 * of them is not the amount, and a later one is: the amount is another price on the line ("$5
 * monthly service charge when balance falls below $300. $2 paper statement fee" at $2). The head
 * names the first price, so the line is never renamed, and since the amount is a price the line
 * states, it is kept live as a `reread` rather than refused.
 */
export function liveFragmentPriceElsewhere(name: string, amount: number): boolean {
  const figures = [...priceReadable(name).matchAll(LIVE_FRAGMENT_DOLLAR)].map((match) => figureValue(match[1]));
  return figures.length >= 2 && Math.abs(figures[0] - amount) > 0.005 && figures.some((value) => Math.abs(value - amount) < 0.005);
}
/**
 * v4 (#1499): any figure, dollar or bare ("$500", "12 months", "6 withdrawals"). On a tail line the
 * fee's own price follows the cut-off "of", so an amount equal to a figure already in the line was
 * read from that figure (a threshold, a count, another price) and the tail is never used.
 * v5: group 1 is a leading "$", group 2 the figure, group 3 a count noun after it. A bare whole
 * figure followed by a count noun ("more than 6 debits per month") is a count, never the price,
 * so it does not block (137819). A span of time ("5 days", "12 months", "3 years") still blocks: it
 * is the threshold a dormancy or overdrawn fee is read from (97910 "After 5 days" $5, "If more
 * than 3 years dormant" $3). v6 (133104): group 4 is a period after the figure; a dollar figure
 * with one ("$3 per quarter", "$5 monthly") is the fee's own price, so it never blocks.
 */
export const LIVE_FRAGMENT_FIGURE = /(\$\s?)?(\d[\d,]*(?:\.\d+)?)(\s+(?:debits?|withdrawals?|transactions?|transfers?|checks?|items?|times)\b)?(\s*(?:(?:per|an?|each|\/)\s*(?:months?|quarters?|qtrs?|years?|statements?|(?:statement\s+)?cycles?)|monthly|quarterly|annually|yearly)\b)?/gi;
const figureValue = (text: string) => Number(text.replace(/,/g, ""));

/**
 * v4 (#1499): true when a figure in the name equals the amount (6 = 6.00, commas ignored). v5: read
 * on the name as the head is read (`gluedReadable`: a glued footnote number dropped, 109893
 * "10NON-MEMBER LOAN APPLICATION FEE" $10), skipping a bare count (`LIVE_FRAGMENT_FIGURE`) only on an
 * amount under `LIVE_FRAGMENT_CONDITION_MAX` ("more than 1,000 items" $1,000 still blocks).
 */
export function liveFragmentFigureIsAmount(name: string, amount: number): boolean {
  // Round 5 (rev11): a "$" figure counts only when a threshold word leads into it ("more than $5");
  // a bare "$100.00 per occurrence" at $100 is the fee's own price and never refuses.
  const readable = gluedReadable(name);
  // Round 6 (rev12): a bare figure with cents ("100.00 per occurrence") reads like the "$" form.
  return [...readable.matchAll(LIVE_FRAGMENT_FIGURE)].some((match) =>
    match[1] == null && !/\.\d{2}$/.test(match[2]) && !(amount < LIVE_FRAGMENT_CONDITION_MAX && !match[2].includes(".") && match[3] != null)
    && Math.abs(figureValue(match[2]) - amount) < 0.005)
    || [...readable.matchAll(LIVE_FRAGMENT_THRESHOLD_FIGURE)].some((match) => Math.abs(figureValue(match[1] ?? match[2]) - amount) < 0.005);
}

/** v3 (#1499): true when the name states a price other than the fee's own (see `LIVE_FRAGMENT_PRICED_FEE`). */
export function liveFragmentOtherPrice(name: string, amount: number): boolean {
  const differs = (text: string) => Math.abs(figureValue(text) - amount) > 0.005;
  // v6 (70303): a priced figure a threshold word leads into ("overdrawn more than $5.00 Fees for") is a threshold too.
  // v6 (review 9): a credit or discount figure ("$2 credit with e-statements") is no other price either.
  const unthresholded = priceReadable(name);
  // Round 5 (rev11): when the first dollar figure is the amount, the line opens on the fee's own price.
  const first = LIVE_FRAGMENT_DOLLAR_FIRST.exec(unthresholded);
  if (first != null && !differs(first[1])) return false;
  const priced = [...unthresholded.matchAll(LIVE_FRAGMENT_PRICED_FEE)].map((match) => match[1]);
  if (priced.length >= 2 || priced.some(differs)) return true;
  return !LIVE_FRAGMENT_BALANCE_WORD.test(name) && [...unthresholded.matchAll(LIVE_FRAGMENT_DOLLAR)].some((match) => differs(match[1]));
}

/** v5 (#1499): `reread` keeps the fee live and asks Knox to re-read its line (a `sentence_end` line with no rename). */
export type LiveFragmentAction = "takedown" | "rename" | "exempt" | "reread";
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
  /** v6 (#1499): the document the fee was read from (raw tier, through its verified row); null when unknown. */
  source_document_id?: number | string | null;
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
const emptyByAction = (): Record<LiveFragmentAction, PatternCounts> => ({ takedown: emptyPatterns(), rename: emptyPatterns(), exempt: emptyPatterns(), reread: emptyPatterns() });
const emptySamples = (): Record<LiveFragmentAction, LiveFragmentSample[]> => ({ takedown: [], rename: [], exempt: [], reread: [] });

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
  /** v5: matches kept live that ask Knox to re-read their source line (`reread`: `sentence_end` lines with no rename). */
  wouldReread: number;
  /** v2: fees that would ask Knox to re-read their source line (v5: the `reread` matches). */
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
 * Round 8 (139153): the head a closing "account you have at <bank>" clause leaves
 * (`LIVE_FRAGMENT_OWN_ACCOUNT`), or null. The head must name a fee, carry no price, waiver or
 * reduced wording, open on no sentence opener, be no fragment itself, and keep the category guard's
 * verdict. The amount may be $0 (a fee the schedule lists as free), not unknown.
 */
export function liveFragmentOwnAccountHead(name: string, amount: number | null, canonicalFeeKey: string | null = null): string | null {
  if (amount == null || amount < 0) return null;
  const match = LIVE_FRAGMENT_OWN_ACCOUNT.exec(name);
  const head = match?.[1]?.trim();
  if (!head) return null;
  if (LIVE_FRAGMENT_WAIVE_WORDING.test(name) || LIVE_FRAGMENT_REDUCED_WORDING.test(name)) return null;
  if (LIVE_FRAGMENT_PRICE_IN_NAME.test(head) || !LIVE_FRAGMENT_FEE_NOUN.test(head) || LIVE_FRAGMENT_SENTENCE_OPENER.test(head)) return null;
  if (liveFragmentName(head) != null) return null;
  if (canonicalFeeKey != null && checkFeeCategory(canonicalFeeKey, name).ok && !checkFeeCategory(canonicalFeeKey, head).ok) return null;
  return head;
}

/**
 * Pure (#1443): what the re-check does with one live name, or null when the name carries no live
 * fragment shape. See the module note for the rules.
 */
export function liveFragmentVerdict(
  name: string | null | undefined,
  amount: number | null,
  canonicalFeeKey: string | null = null,
): LiveFragmentVerdict | null {
  const found = liveFragmentVerdictDetail(name, amount, canonicalFeeKey);
  return found && found.verdict;
}

export type LiveFragmentVerdict = { pattern: LiveFragmentPattern; action: LiveFragmentAction; renameTo?: string; renameVia?: LiveFragmentRenameVia; exemptReason?: LiveFragmentExemptReason };

/**
 * `liveFragmentVerdict` with `amountRefused`: true when a gate refused the rename because the
 * amount is not the fee's price (total wording, an opening deposit, another price in the line, a
 * figure equal to the amount, a refused "if"/"when" threshold). v5 (#1499): such a `sentence_end`
 * line is a `takedown` that also asks Knox to re-read it, as in v4; only a line no gate refused on
 * its amount is a `reread` kept live.
 */
export function liveFragmentVerdictDetail(
  name: string | null | undefined,
  amount: number | null,
  canonicalFeeKey: string | null = null,
): { verdict: LiveFragmentVerdict; amountRefused: boolean } | null {
  const verdict = (found: LiveFragmentVerdict, amountRefused = false) => ({ verdict: found, amountRefused });
  const pattern = liveFragmentCheckShape(name);
  if (!pattern) return null;
  if (pattern === "pronoun" && !liveFragmentName(name)) return verdict({ pattern, action: "exempt", exemptReason: "parenthetical" });
  const current = (name ?? "").replace(/\s+/g, " ").trim();
  const waived = LIVE_FRAGMENT_WAIVE_WORDING.test(current);
  if (pattern === "trailing_range") {
    // Round 5 (rev11): a waived trailing range at a positive amount is kept live for a re-read; $0 comes down.
    if (amount === 0) return verdict({ pattern, action: "takedown" });
    return verdict(waived ? { pattern, action: "reread" } : { pattern, action: "exempt", exemptReason: "trailing_range_priced" });
  }
  if (pattern === "plus") return verdict({ pattern, action: "takedown" });
  // Round 8 (139153): a closing "account you have at <bank>" clause renames to the head at any
  // amount, $0 included, when the head names a fee and passes the usual target checks.
  const ownAccount = pattern === "pronoun" ? liveFragmentOwnAccountHead(current, amount, canonicalFeeKey) : null;
  if (ownAccount) return verdict({ pattern, action: "rename", renameTo: ownAccount, renameVia: "head" });
  // v6 round 4 (#1499): a pronoun or sentence_end line comes down outright only when its amount is
  // $0 or unknown, the amount is a credit or discount, or the line opens on a worked example or
  // another bank's charge (`liveFragmentNotAFee`). Waiver wording alone never takes a priced fee down.
  const credit = amount != null && amount > 0 && liveFragmentCredit(current, amount);
  if (amount == null || amount <= 0 || (credit && !liveFragmentCreditHeaded(current)) || liveFragmentNotAFee(current)) {
    return verdict({ pattern, action: "takedown" });
  }
  // Round 7 (#1521): a credit after a fee head with no price of its own is kept live for a re-read.
  if (credit) return verdict({ pattern, action: "reread" });
  // Round 4: every refusal goes through one soft check: under $100 it is a `reread`, at $100 or more a
  // takedown with a re-read request. No rename either way.
  const soft = liveFragmentSoft(current, amount);
  const figureIsAmount = liveFragmentFigureIsAmount(current, amount);
  let split = gluedSentenceSplit(current, { allowGeneric: true });
  // The narrow forms a head renames over: a balance-below condition (a generic head only when the
  // line does not end on "balance of"), a dormancy tier, or a duration the head itself names; each
  // under $100, with no figure equal to the amount and a head ending on "fee" or "charge".
  // Round 5: the balance form only under `LIVE_FRAGMENT_BALANCE_MAX` ($25).
  const balanceForm = split != null && amount < LIVE_FRAGMENT_BALANCE_MAX && LIVE_FRAGMENT_BALANCE_FORM.test(split.rest);
  const exception = split != null && amount < LIVE_FRAGMENT_CONDITION_MAX && !figureIsAmount && LIVE_FRAGMENT_FEE_HEAD.test(split.head)
    && (split.generic
      ? balanceForm && !LIVE_FRAGMENT_THRESHOLD_END.test(split.rest)
      : balanceForm || LIVE_FRAGMENT_TIER_CONDITION.test(split.rest)
        || (LIVE_FRAGMENT_DURATION_HEAD.test(split.head) && LIVE_FRAGMENT_DURATION_FORM.test(split.rest)));
  let refused = false;
  // Round 6: `held` keeps a line live with no rename and never takes it down (a floor, a bare if/when clause).
  const floor = LIVE_FRAGMENT_FLOOR_WORDING.test(current);
  let held = floor;
  if (LIVE_FRAGMENT_OPENING_DEPOSIT.test(current) || LIVE_FRAGMENT_TOTAL_WORDING.test(current) || liveFragmentCapRefused(current, amount)
      || (liveFragmentThresholdEnd(current, amount) && !exception)) {
    refused = true;
  } else if (liveFragmentPriceElsewhere(current, amount)) {
    // v6 (125163, 125166): the amount is a later price on the line: no rename, kept live for a re-read.
    return verdict({ pattern, action: "reread" });
  } else if (liveFragmentOtherPrice(current, amount)) {
    refused = true;
  }
  let candidate: { renameTo: string; renameVia: LiveFragmentRenameVia } | null = null;
  if (!refused && split) {
    const ifCondition = LIVE_FRAGMENT_IF_CONDITION.test(split.rest);
    // v6: a balance band ("more than or equal to but less than") is the fee's own tier, not a threshold.
    const band = LIVE_FRAGMENT_BAND_CONDITION.test(split.rest);
    if (split.generic) {
      // v5 (142422): a generic head ("Monthly Fee") renames only on the balance form; else it is no head.
      if (exception) candidate = { renameTo: split.head, renameVia: "head" };
      else {
        if (ifCondition && !band) {
          if (LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(split.rest) || figureIsAmount) refused = true;
          else held = true;
        }
        split = null;
      }
    } else if (ifCondition) {
      if (exception) candidate = { renameTo: split.head, renameVia: "head" };
      else if (!band) {
        if (LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(split.rest) || figureIsAmount) refused = true;
        else held = true;
      }
    } else if (LIVE_FRAGMENT_REST_CONDITION.test(split.rest) && figureIsAmount) {
      refused = true;
    } else if (LIVE_FRAGMENT_CHARGE_SENTENCE.test(split.rest)) {
      // Round 5 (rev11): the rest is one bare "this is the charge" sentence and nothing else.
      candidate = { renameTo: split.head, renameVia: "head" };
    }
  }
  if (!refused && !held && !split && pattern === "sentence_end") {
    // v3: no head, so the fee its sentence ends on; v4: never when a figure in the line is the amount.
    // Round 4 (D): the whole line passes the rename bar.
    if (figureIsAmount) refused = true;
    // Round 7 (#1521): never on a line cut at its start ("accounts are charged an overdraft fee of": the
    // cut-off text may hold the subject, "Business accounts"), as for a head (`LIVE_FRAGMENT_CUT_START`).
    else if (!LIVE_FRAGMENT_CUT_START.test(gluedReadable(current))
        && LIVE_FRAGMENT_TAIL_LEAD.test(gluedReadable(current)) && !LIVE_FRAGMENT_RENAME_BAR.test(gluedReadable(current).replace(LIVE_FRAGMENT_TAIL_LEAD, ""))
        && !LIVE_FRAGMENT_TAIL_REDUCED.test(gluedReadable(current).replace(LIVE_FRAGMENT_TAIL_LEAD, ""))) {
      // Round 5 (rev11): the line opens on a bare charge clause and the rest passes the bar.
      const tail = feeOfSentenceTail(current);
      if (tail) candidate = { renameTo: tail, renameVia: "tail" };
    }
  }
  // v6 (#1499 review): waiver, discount or reduced wording bars a rename only: the line is kept live for a re-read.
  // v6 (125163, 125166, 64144): a period-and-service head on a line cut at its start, or one opening on "per", is no rename.
  // Round 4 (C, prod r10 64675): a target with a digit or "$", with no fee noun, or opening on a sentence opener is no rename.
  const headBarred = candidate?.renameVia === "head"
    && ((LIVE_FRAGMENT_CUT_START.test(gluedReadable(current)) && LIVE_FRAGMENT_CUT_GENERIC_HEAD.test(candidate.renameTo)) || LIVE_FRAGMENT_PER_HEAD.test(candidate.renameTo));
  if (candidate && !refused && !held && !waived && !LIVE_FRAGMENT_REDUCED_WORDING.test(current) && !headBarred
      && !LIVE_FRAGMENT_PRICE_IN_NAME.test(candidate.renameTo) && LIVE_FRAGMENT_FEE_NOUN.test(candidate.renameTo)
      && !LIVE_FRAGMENT_SENTENCE_OPENER.test(candidate.renameTo) && liveFragmentName(candidate.renameTo) == null) {
    // Knox's rename bar: a name the category guard accepted must still be accepted once cleaned.
    const guardOk = canonicalFeeKey == null || !checkFeeCategory(canonicalFeeKey, current).ok || checkFeeCategory(canonicalFeeKey, candidate.renameTo).ok;
    if (guardOk) return verdict({ pattern, action: "rename", renameTo: candidate.renameTo, renameVia: candidate.renameVia });
  }
  // v5/v6 (#1499): a line with no rename and a plausible amount is usually a real fee Knox read badly:
  // kept live, re-read. Round 4: one a gate refused comes down (with a re-read request) only at $100 or more.
  const takedown = refused && !soft && !floor;
  return verdict({ pattern, action: takedown ? "takedown" : "reread" }, takedown);
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
 * v6 (#1499): a live twin's key with its source document (`liveNameKey` plus the document). A
 * rename onto a live name comes down as `rename_duplicate` only when the twin was read from the
 * fragment's own document; null when the document is unknown (then it never comes down).
 */
export function liveTwinKey(institutionId: number | string, canonicalFeeKey: string | null | undefined, amount: number | string | null, name: string, sourceDocumentId: number | string | null | undefined): string | null {
  const doc = num(sourceDocumentId);
  return doc == null ? null : `${liveNameKey(institutionId, canonicalFeeKey, amount, name)}|doc:${doc}`;
}

/** v6 (#1499): a fragment's line, as near as the live tier can tell it: its document and its own stored name. */
function fragmentLineKey(twinKey: string | null, fragmentName: string): string | null {
  return twinKey == null ? null : `${twinKey}|line:${fragmentName.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/**
 * Pure: the live rows whose catalog name is a fragment, counted by pattern and action, with every
 * match kept. `liveNames` holds the keys (`liveNameKey`, and `liveTwinKey` where the document is
 * known) of live fees outside `rows`; the rows' own names are added. v6 (#1499): a rename onto a
 * live name comes down (`rename_duplicate`) only when that twin was read from the same source
 * document; a rename onto the name an earlier fragment (by id) takes comes down only when both come
 * from the same document and the same line (the same stored fragment name). Any other collision is
 * kept live as a `reread`: on prod 4 of 24 duplicates took down another account's fee.
 */
export function findLiveFragments(rows: LiveFragmentRow[], liveNames: ReadonlySet<string> = new Set()): LiveFragmentFindings & { matches: LiveFragmentSample[] } {
  const byPattern = emptyPatterns();
  const byAction = emptyByAction();
  const samplesByAction = emptySamples();
  const exemptByReason: Record<LiveFragmentExemptReason, number> = { parenthetical: 0, trailing_range_priced: 0 };
  const takedownByReason: Record<LiveFragmentTakedownReason, number> = { fragment: 0, rename_duplicate: 0 };
  const renameDuplicateSamples: LiveFragmentSample[] = [];
  const taken = new Set(liveNames);
  for (const row of rows) {
    if (!row.fee_name) continue;
    taken.add(liveNameKey(row.institution_id, row.canonical_fee_key, row.amount, row.fee_name));
    const twin = liveTwinKey(row.institution_id, row.canonical_fee_key, row.amount, row.fee_name, row.source_document_id);
    if (twin) taken.add(twin);
  }
  const matches: LiveFragmentSample[] = [];
  const ordered = [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id));
  for (const row of ordered) {
    const amount = num(row.amount);
    const canonicalFeeKey = row.canonical_fee_key ?? null;
    const detail = liveFragmentVerdictDetail(row.fee_name, amount, canonicalFeeKey);
    if (!detail) continue;
    const { verdict } = detail;
    let { action } = verdict;
    let takedownReason: LiveFragmentTakedownReason | undefined = action === "takedown" ? "fragment" : undefined;
    if (action === "rename" && verdict.renameTo) {
      const key = liveNameKey(row.institution_id, canonicalFeeKey, amount, verdict.renameTo);
      const twin = liveTwinKey(row.institution_id, canonicalFeeKey, amount, verdict.renameTo, row.source_document_id);
      const line = fragmentLineKey(twin, row.fee_name ?? "");
      if ((twin != null && taken.has(twin)) || (line != null && taken.has(line))) {
        action = "takedown";
        takedownReason = "rename_duplicate";
      } else if (taken.has(key)) {
        // v6: the same name from another document or line is another account's fee: kept live, re-read.
        action = "reread";
      }
      taken.add(key);
      if (line) taken.add(line);
    }
    byPattern[verdict.pattern] += 1;
    byAction[action][verdict.pattern] += 1;
    if (verdict.exemptReason) exemptByReason[verdict.exemptReason] += 1;
    if (takedownReason) takedownByReason[takedownReason] += 1;
    // v5: a reread kept live, or a sentence_end takedown refused on its amount (as in v4), asks Knox to re-read.
    // v6: a pronoun line refused on its amount asks for a re-read too.
    const rereadRequest = action === "reread" || (takedownReason === "fragment" && detail.amountRefused);
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
    wouldReread: count("reread"),
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
 * Round 6/7 (#1499, #1521): the characters JS's `\s` reads as whitespace that Postgres's `\s` does not
 * (glibc's UTF-8 classes leave out the no-break spaces and U+FEFF): the SQL reads each as a space first,
 * so a name's collapsed form is the same on both sides.
 */
export const LIVE_FRAGMENT_SQL_SPACES = "\u00A0\u2007\u202F\uFEFF";
export const LIVE_FRAGMENT_SQL_SPACES_TO = " ".repeat(LIVE_FRAGMENT_SQL_SPACES.length);
/** The same characters as a Postgres Unicode escape literal, for the count SQL. */
const LIVE_FRAGMENT_SQL_SPACES_LITERAL = `U&'${[...LIVE_FRAGMENT_SQL_SPACES].map((char) => `\\${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join("")}'`;

/**
 * The live names outside a read that the read's rename candidates could collide with: every live
 * fee (not rolled back or quarantined) of the candidates' banks whose collapsed, case-free name is
 * one of the new names. Null when the read fails.
 */
async function liveNamesFor(db: SqlTag, rows: LiveFragmentRow[]): Promise<Set<string> | null> {
  const candidates = findLiveFragments(rows).matches.filter((fee) => fee.renameTo != null && fee.action !== "exempt");
  if (candidates.length === 0) return new Set();
  try {
    const existing = await inSavepoint(db, (scope) => scope<{ institution_id: number | string; canonical_fee_key: string | null; amount: number | string | null; fee_name: string; source_document_id?: number | string | null }[]>`
      SELECT fp.institution_id, fp.canonical_fee_key, fp.amount, fp.fee_name, fr.source_document_id
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.institution_id = ANY(${[...new Set(candidates.map((fee) => fee.institutionId))]}::bigint[])
         AND lower(btrim(regexp_replace(translate(fp.fee_name, ${LIVE_FRAGMENT_SQL_SPACES}, ${LIVE_FRAGMENT_SQL_SPACES_TO}), '\\s+', ' ', 'g'))) = ANY(${[...new Set(candidates.map((fee) => (fee.renameTo ?? "").toLowerCase()))]}::text[])
    `);
    return new Set(existing.flatMap((row) => {
      const twin = liveTwinKey(row.institution_id, row.canonical_fee_key, row.amount, row.fee_name, row.source_document_id);
      return [liveNameKey(row.institution_id, row.canonical_fee_key, row.amount, row.fee_name), ...(twin ? [twin] : [])];
    }));
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
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key, fr.source_document_id
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
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
  const rereads = matches.filter((fee) => fee.action === "reread");

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
  const down = new Set(result.takenDown);
  const rereadFees = [...rereads, ...takedowns.filter((fee) => fee.rereadRequest && down.has(fee.feePublishedId))];
  if (live && !options.dryRun && rereadFees.length > 0) {
    // v5 (#1499): each `sentence_end` line kept live (`reread`), and each taken down on its amount, asks Knox to re-read it.
    result.rereadRequested = await requestKnoxRereads(db, rereadFees, options.runId);
  }
  if (result.takenDown.length > 0 || result.renamed.length > 0) invalidatePublicReadCache();

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LIVE_FRAGMENT_CHECK}, 'completed',
          ${`Read ${result.checked} live fee name(s): ${result.matched} fragment shape(s), ${result.wouldTakeDown} takedown, ${result.wouldRename} rename, ${result.wouldReread} kept for re-read, ${result.exempt} exempt; ${live ? `${result.takenDown.length} archived, ${result.renamed.length} renamed, ${result.rereadRequested.length} re-read request(s) to Knox (kept live)` : "switch off, nothing written"}`},
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
 * live fee came from. Returns the fees written; a failure writes none. v5: the fees are the `reread`
 * matches, kept live; nothing is taken down for them.
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
            reason: fee.action === "reread" ? liveFragmentKeptReason(fee.pattern) : liveFragmentReason(fee.pattern, fee.takedownReason),
            ...(fee.action === "reread" ? { kept_live: true } : {}),
            strategy_version: LIVE_FRAGMENT_STRATEGY.version,
            consumer: "knox.reread_feedback (#1511)",
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

/** The findings as ledger detail, split by action (takedown / rename / reread / exempt) with samples of each. */
export function liveFragmentFindingsDetail(found: LiveFragmentFindings) {
  return {
    checked: found.checked,
    matched: found.matched,
    would_take_down: found.wouldTakeDown,
    would_rename: found.wouldRename,
    would_rename_by_via: found.wouldRenameByVia,
    exempt: found.exempt,
    would_reread: found.wouldReread,
    would_request_reread: found.wouldRequestReread,
    exempt_by_reason: found.exemptByReason,
    takedown_by_reason: found.takedownByReason,
    by_pattern: found.byPattern,
    by_action: found.byAction,
    samples_by_action: {
      takedown: found.samplesByAction.takedown.map(sampleDetail),
      rename: found.samplesByAction.rename.map(sampleDetail),
      exempt: found.samplesByAction.exempt.map(sampleDetail),
      reread: found.samplesByAction.reread.map(sampleDetail),
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
 * takedown (v6: only with the twin from the same source document, or the earlier fee from the same
 * document and stored name; any other collision is a `reread`). Two known differences: Postgres's word boundary reads non-ASCII letters as word
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
 * from the same regexes. v5: the re-read requests to Knox are the `reread` / `reread` /
 * `sentence_end` row (kept live) plus the `takedown` / `fragment_reread` / `sentence_end` row
 * (taken down because a gate refused the amount); together the step's `would_request_reread`. A
 * `takedown` / `fragment` / `sentence_end` row ($0, no amount, waiver wording) asks for none. v5 (#1499): a generic head
 * (`glued_generic_bars`) renames only through `generic_ok` (an "if"/"when" balance condition under
 * $100 with no figure equal to the amount); otherwise the line may still take its tail. The figure
 * gate reads `readable` (footnote dropped) and skips a bare whole figure before a count noun.
 * v6: `pronoun` lines follow the same reasons as `sentence_end`; `fragment` is $0 / no amount /
 * credit / no fee of this bank (and `plus`, waived `trailing_range`); `amount_refused` adds cap
 * words and a line ending on a threshold ("balance of" / "balance is", "more than", "over",
 * "inactive for", or "below" / "under" / "less than" at $100 or more), and leaves out a balance
 * band. Waiver wording bars `renamable` only (the line is a `reread`). The colon head gate carries
 * the balance gate's bars. A threshold ending on a fee line under $100 is kept (no refusal; it renames
 * only through a proper head's balance condition); `price_elsewhere` (a later dollar price is the
 * amount) is a `reread` that no price, head or figure gate refuses; `figure_is_amount` skips a dollar
 * figure with a period. Review 9 / prod r9: the soft hold (`liveFragmentSoft`) turns the head, colon,
 * generic and glued-condition refusals into rereads under $100 on a fee line; the credit and cap reads
 * compare their figure with the amount; Darwin's all-capitals article shape is read here only.
 * Round 4: `exception_ok` holds the three narrow head forms, `gate_refused` every refusal (under
 * $100 a `reread`, else `fragment_reread`), the rename and tail branches read `LIVE_FRAGMENT_RENAME_BAR`
 * on `rest` and on `readable`, and the target checks run on `head` and `tail`; "no fee of this bank"
 * reads the line before its first marker (`regexp_replace(... '.*$')`) for a fee word.
 * Round 5: the head branch reads `LIVE_FRAGMENT_CHARGE_SENTENCE` on `rest`, the tail branch
 * `LIVE_FRAGMENT_TAIL_LEAD` on `readable` and the bar on what follows it; "no fee of this bank" is a
 * plain start-anchored match; `first_is_amount` lifts the other-price gate; the figure gate reads
 * bare figures and threshold dollars only.
 * Round 7 (#1521): the if/when threshold read, the credit's own-price read (`LIVE_FRAGMENT_OWN_PRICE`)
 * and its credit word come from the same regexes; a credit line with a fee head and no price before
 * its credit (`creditBefore`) is a `reread`; `rename_tail` needs `readable` not to open in lower case;
 * U+FEFF joins the no-break spaces in the `translate`.
 * v7 (#1521): `sentence_end` also reads `sentence_end_audience` (a count and an audience word ending the name).
 */
export function liveFragmentCountSql(): string {
  const re = LIVE_FRAGMENT_REGEXES;
  const waive = postgresPattern(LIVE_FRAGMENT_WAIVE_WORDING);
  const deposit = postgresPattern(LIVE_FRAGMENT_OPENING_DEPOSIT);
  const barsOn = (column: string, bars: readonly RegExp[] = [...re.glued_head_bars, ...re.glued_generic_bars]) =>
    bars.map((bar) => `${column} !~${bar.flags.includes("i") ? "*" : ""} '${postgresPattern(bar)}'`).join(" AND ");
  const ifCondition = `rest ~* '${postgresPattern(LIVE_FRAGMENT_IF_CONDITION)}'`;
  const priced = postgresPattern(LIVE_FRAGMENT_PRICED_FEE);
  const dollar = postgresPattern(LIVE_FRAGMENT_DOLLAR);
  const credit = postgresPattern(LIVE_FRAGMENT_CREDIT);
  const capDollar = postgresPattern(LIVE_FRAGMENT_CAP_DOLLAR);
  const unthresholded = `regexp_replace(regexp_replace(regexp_replace(name, '${postgresPattern(LIVE_FRAGMENT_THRESHOLD_DOLLAR)}', ' ', 'gi'), '${credit}', ' ', 'gi'), '${capDollar}', ' ', 'gi')`;
  const creditIsAmount = `(EXISTS (SELECT 1 FROM regexp_matches(name, '${credit}', 'gi') m WHERE (m[3] IS NULL OR name ~* '${postgresPattern(LIVE_FRAGMENT_CREDIT_WORD)}') AND abs(replace(COALESCE(m[1], m[2], m[3], m[4], m[5]), ',', '')::numeric - amount) < 0.005)`
    + ` AND NOT EXISTS (SELECT 1 FROM regexp_matches(regexp_replace(name, '${credit}', ' ', 'gi'), '${postgresPattern(LIVE_FRAGMENT_OWN_PRICE)}', 'g') m WHERE abs(replace(COALESCE(m[1], m[2]), ',', '')::numeric - amount) < 0.005))`;
  // Round 7 (#1521): the line before its first credit phrase names a fee and no price of its own.
  const creditBefore = `regexp_replace(name, '(?:${credit}).*$', '', 'i')`;
  const creditHeaded = `(${creditBefore} ~* '${postgresPattern(LIVE_FRAGMENT_CREDIT_HEAD)}' AND ${creditBefore} !~ '${postgresPattern(LIVE_FRAGMENT_OWN_PRICE)}')`;
  const notAFee = `(name ~* '${postgresPattern(LIVE_FRAGMENT_NOT_A_FEE)}' OR (name ~* '${postgresPattern(LIVE_FRAGMENT_OTHER_BANK)}' AND name !~* '${postgresPattern(LIVE_FRAGMENT_FEE_WORD)}'))`;
  const floor = `name ~* '${postgresPattern(LIVE_FRAGMENT_FLOOR_WORDING)}'`;
  const ifHard = `(rest ~* '${postgresPattern(LIVE_FRAGMENT_IF_THRESHOLD_WORD)}' OR COALESCE(figure_is_amount, false))`;
  const capRefused = `(name ~* '${postgresPattern(LIVE_FRAGMENT_CAP_WORDING)}' AND NOT EXISTS (SELECT 1 FROM regexp_matches(regexp_replace(name, '${capDollar}', ' ', 'gi'), '${dollar}', 'g') m WHERE abs(replace(m[1], ',', '')::numeric - amount) < 0.005))`;
  const soft = `amount < ${LIVE_FRAGMENT_CONDITION_MAX}`;
  const restCondition = `rest ~* '${postgresPattern(LIVE_FRAGMENT_REST_CONDITION)}'`;
  const headBarred = `((readable ~ '${postgresPattern(LIVE_FRAGMENT_CUT_START)}' AND head ~* '${postgresPattern(LIVE_FRAGMENT_CUT_GENERIC_HEAD)}') OR head ~* '${postgresPattern(LIVE_FRAGMENT_PER_HEAD)}')`;
  const balanceForm = `(amount < ${LIVE_FRAGMENT_BALANCE_MAX} AND rest ~* '${postgresPattern(LIVE_FRAGMENT_BALANCE_FORM)}')`;
  const band = `rest ~* '${postgresPattern(LIVE_FRAGMENT_BAND_CONDITION)}'`;
  const bar = postgresPattern(LIVE_FRAGMENT_RENAME_BAR);
  const tailLead = postgresPattern(LIVE_FRAGMENT_TAIL_LEAD);
  const exception = `COALESCE(amount < ${LIVE_FRAGMENT_CONDITION_MAX} AND NOT COALESCE(figure_is_amount, false) AND head ~* '${postgresPattern(LIVE_FRAGMENT_FEE_HEAD)}' AND (`
    + `(head_generic AND ${balanceForm} AND rest !~* '${postgresPattern(LIVE_FRAGMENT_THRESHOLD_END)}')`
    + ` OR (head_ok AND (${balanceForm} OR rest ~* '${postgresPattern(LIVE_FRAGMENT_TIER_CONDITION)}'`
    + ` OR (head ~* '${postgresPattern(LIVE_FRAGMENT_DURATION_HEAD)}' AND rest ~* '${postgresPattern(LIVE_FRAGMENT_DURATION_FORM)}')))), false)`;
  const thresholdEnd = `(name ~* '${postgresPattern(LIVE_FRAGMENT_THRESHOLD_END)}' OR name ~* '${postgresPattern(LIVE_FRAGMENT_EXCESS_END)}' OR (amount >= ${LIVE_FRAGMENT_CONDITION_MAX} AND name ~* '${postgresPattern(LIVE_FRAGMENT_BELOW_END)}'))`;
  const hardGates = `name ~* '${deposit}' OR name ~* '${postgresPattern(LIVE_FRAGMENT_TOTAL_WORDING)}' OR ${capRefused}`
    + `\n           OR (${thresholdEnd} AND NOT exception_ok)`;
  // Round 8 (139153): a closing "account you have at <bank>" clause renames to its head at any amount.
  const ownAccountRename = `(pattern = 'pronoun' AND amount >= 0 AND own_account_head IS NOT NULL AND renamable`
    + ` AND own_account_head !~ '${postgresPattern(LIVE_FRAGMENT_PRICE_IN_NAME)}' AND own_account_head ~* '${postgresPattern(LIVE_FRAGMENT_FEE_NOUN)}'`
    + ` AND own_account_head !~* '${postgresPattern(LIVE_FRAGMENT_SENTENCE_OPENER)}')`;
  const target = (column: string) => `${column} !~ '${postgresPattern(LIVE_FRAGMENT_PRICE_IN_NAME)}' AND ${column} ~* '${postgresPattern(LIVE_FRAGMENT_FEE_NOUN)}' AND ${column} !~* '${postgresPattern(LIVE_FRAGMENT_SENTENCE_OPENER)}'`;
  return `WITH live AS (
  SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fp.amount, fr.source_document_id,
         btrim(regexp_replace(translate(COALESCE(fp.fee_name, ''), ${LIVE_FRAGMENT_SQL_SPACES_LITERAL}, '${LIVE_FRAGMENT_SQL_SPACES_TO}'), '\\s+', ' ', 'g')) AS name
    FROM published_fee_records fp
    LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
   WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL
), tagged AS (
  SELECT *, CASE
    WHEN name ~ '${postgresPattern(re.plus)}' AND regexp_replace(name, '^\\++\\s*', '') !~* '${postgresPattern(re.plus_fee_noun)}' THEN 'plus'
    WHEN name ~* '${postgresPattern(new RegExp(re.trailing_range.source.replace(/^\[[^\]]*\]\*/, "")))}' THEN 'trailing_range'
    WHEN name ~* '${postgresPattern(re.sentence_end)}' OR name ~ '${postgresPattern(re.sentence_end_article)}' OR name ~* '${postgresPattern(re.sentence_end_audience)}' OR name ~ '${postgresPattern(LIVE_FRAGMENT_CAPS_ARTICLE)}' THEN 'sentence_end'
    WHEN name ~* '${postgresPattern(re.pronoun)}' THEN 'pronoun'
  END AS pattern,
  btrim(regexp_replace(regexp_replace(name, '${postgresPattern(re.parenthetical)}', ' ', 'g'), '\\s+', ' ', 'g')) AS outside,
  regexp_replace(btrim(regexp_replace(name, '${postgresPattern(re.glued_cont_mark)}', '', 'gi')), '${postgresPattern(re.glued_lead_strip)}', '') AS readable,
  btrim((regexp_match(name, '${postgresPattern(re.fee_of_sentence_tail)}', 'i'))[1]) AS tail_raw,
  (SELECT count(*) FROM regexp_matches(${unthresholded}, '${priced}', 'gi')) AS priced_count,
  EXISTS (SELECT 1 FROM regexp_matches(${unthresholded}, '${priced}', 'gi') m WHERE replace(m[1], ',', '')::numeric <> amount)
    OR (name !~* '\\ybalances?\\y' AND EXISTS (SELECT 1 FROM regexp_matches(${unthresholded}, '${dollar}', 'g') m WHERE replace(m[1], ',', '')::numeric <> amount)) AS other_figure,
  COALESCE((SELECT abs(replace(t.m[1], ',', '')::numeric - amount) < 0.005 FROM regexp_matches(${unthresholded}, '${dollar}', 'g') WITH ORDINALITY AS t(m, ord) WHERE t.ord = 1), false) AS first_is_amount,
  COALESCE((SELECT count(*) >= 2 AND abs(min(f.v) FILTER (WHERE f.ord = 1) - amount) > 0.005 AND bool_or(abs(f.v - amount) < 0.005)
     FROM (SELECT replace(t.m[1], ',', '')::numeric AS v, t.ord FROM regexp_matches(${unthresholded}, '${dollar}', 'g') WITH ORDINALITY AS t(m, ord)) f), false) AS price_elsewhere
  FROM live
), matched AS (
  SELECT *, substring(readable from '${postgresPattern(re.glued_sentence)}') AS head_plain,
         EXISTS (SELECT 1 FROM regexp_matches(readable, '${postgresPattern(LIVE_FRAGMENT_FIGURE)}', 'gi') m
                  WHERE m[1] IS NULL AND m[2] !~ '\\.\\d{2}$' AND NOT (amount < ${LIVE_FRAGMENT_CONDITION_MAX} AND m[2] !~ '\\.' AND m[3] IS NOT NULL) AND abs(replace(m[2], ',', '')::numeric - amount) < 0.005)
           OR EXISTS (SELECT 1 FROM regexp_matches(readable, '${postgresPattern(LIVE_FRAGMENT_THRESHOLD_FIGURE)}', 'gi') m WHERE abs(replace(COALESCE(m[1], m[2]), ',', '')::numeric - amount) < 0.005) AS figure_is_amount,
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
         COALESCE(head IS NOT NULL AND ${barsOn("head", re.glued_head_bars)} AND NOT (${barsOn("head", re.glued_generic_bars)}), false) AS head_generic,
         substr(COALESCE(CASE WHEN head_plain IS NULL THEN readable_cap END, readable), length(head) + 1) AS rest,
         COALESCE(tail_phrase <> '' AND tail_phrase !~ '${postgresPattern(re.tail_paren_start)}' AND tail_raw !~* '${postgresPattern(re.tail_person)}' AND tail_phrase !~* '${postgresPattern(re.tail_generic_only)}' AND ${barsOn("tail_phrase")}, false) AS tail_ok,
         upper(left(tail_phrase, 1)) || substr(tail_phrase, 2) AS tail,
         name !~* '${waive}' AND name !~* '${postgresPattern(LIVE_FRAGMENT_REDUCED_WORDING)}' AS renamable,
         btrim((regexp_match(name, '${postgresPattern(LIVE_FRAGMENT_OWN_ACCOUNT)}'))[1]) AS own_account_head
    FROM split
), gated AS (
  SELECT *, ${exception} AS exception_ok
    FROM candidate
), refused AS (
  SELECT *, COALESCE(${hardGates}, false) AS hard_refused,
         COALESCE(${floor} OR ${hardGates} OR (NOT price_elsewhere AND ((NOT first_is_amount AND (priced_count >= 2 OR COALESCE(other_figure, false)))
           OR ((head_ok OR head_generic) AND ${ifCondition} AND NOT exception_ok AND NOT ${band})
           OR (head_ok AND NOT ${ifCondition} AND ${restCondition} AND figure_is_amount)
           OR (pattern = 'sentence_end' AND NOT head_ok AND figure_is_amount))), false) AS gate_refused,
         COALESCE(NOT (${floor}) AND (${hardGates} OR (NOT price_elsewhere AND ((NOT first_is_amount AND (priced_count >= 2 OR COALESCE(other_figure, false)))
           OR ((head_ok OR head_generic) AND ${ifCondition} AND NOT exception_ok AND NOT ${band} AND ${ifHard})
           OR (head_ok AND NOT ${ifCondition} AND ${restCondition} AND figure_is_amount)
           OR (pattern = 'sentence_end' AND NOT head_ok AND figure_is_amount)))), false) AS takedown_refused
    FROM gated
), verdict AS (
  SELECT fee_published_id, institution_id, canonical_fee_key, amount, source_document_id, name, pattern, CASE
    WHEN pattern = 'pronoun' AND outside !~* '${postgresPattern(re.pronoun)}' THEN 'parenthetical'
    WHEN pattern = 'trailing_range' THEN CASE WHEN COALESCE(amount, -1) = 0 THEN 'fragment' WHEN name ~* '${waive}' THEN 'reread' ELSE 'trailing_range_priced' END
    WHEN ${ownAccountRename} THEN 'rename'
    WHEN pattern = 'plus' OR amount IS NULL OR amount <= 0 OR (${creditIsAmount} AND NOT ${creditHeaded}) OR ${notAFee} THEN 'fragment'
    WHEN ${creditIsAmount} THEN 'reread'
    WHEN price_elsewhere AND NOT hard_refused THEN 'reread'
    WHEN NOT gate_refused AND renamable AND NOT ${headBarred} AND ${target("head")}
         AND (exception_ok OR (head_ok AND NOT ${ifCondition} AND rest ~* '${postgresPattern(LIVE_FRAGMENT_CHARGE_SENTENCE)}')) THEN 'rename'
    WHEN pattern = 'sentence_end' AND NOT gate_refused AND renamable AND NOT head_ok AND NOT exception_ok AND readable ~* '${tailLead}' AND regexp_replace(readable, '${tailLead}', '', 'i') !~* '${bar}'
         AND regexp_replace(readable, '${tailLead}', '', 'i') !~* '${postgresPattern(LIVE_FRAGMENT_TAIL_REDUCED)}'
         AND readable !~ '${postgresPattern(LIVE_FRAGMENT_CUT_START)}' AND tail_ok AND ${target("tail")} THEN 'rename_tail'
    WHEN takedown_refused AND NOT (${soft}) THEN 'fragment_reread'
    ELSE 'reread'
  END AS first_reason,
  CASE WHEN ${ownAccountRename} THEN own_account_head WHEN head_ok OR exception_ok THEN head WHEN tail_ok THEN tail END AS rename_to
  FROM refused
), ranked AS (
  SELECT v.*,
         row_number() OVER (PARTITION BY v.first_reason IN ('rename', 'rename_tail'), v.institution_id, v.canonical_fee_key, v.amount, lower(v.rename_to) ORDER BY v.fee_published_id) AS rename_rank
    FROM verdict v
), acted AS (
  SELECT r.fee_published_id, r.name, r.amount, r.rename_to, r.pattern, CASE
    WHEN r.first_reason IN ('rename', 'rename_tail') AND r.source_document_id IS NOT NULL AND (EXISTS (
      SELECT 1 FROM live l
       WHERE l.institution_id = r.institution_id
         AND l.canonical_fee_key IS NOT DISTINCT FROM r.canonical_fee_key
         AND l.amount = r.amount
         AND lower(l.name) = lower(r.rename_to)
         AND l.source_document_id = r.source_document_id
    ) OR EXISTS (
      SELECT 1 FROM ranked e
       WHERE e.first_reason IN ('rename', 'rename_tail')
         AND e.fee_published_id < r.fee_published_id
         AND e.institution_id = r.institution_id
         AND e.canonical_fee_key IS NOT DISTINCT FROM r.canonical_fee_key
         AND e.amount = r.amount
         AND lower(e.rename_to) = lower(r.rename_to)
         AND e.source_document_id = r.source_document_id
         AND lower(e.name) = lower(r.name)
    )) THEN 'rename_duplicate'
    WHEN r.first_reason IN ('rename', 'rename_tail') AND (r.rename_rank > 1 OR EXISTS (
      SELECT 1 FROM live l
       WHERE l.institution_id = r.institution_id
         AND l.canonical_fee_key IS NOT DISTINCT FROM r.canonical_fee_key
         AND l.amount = r.amount
         AND lower(l.name) = lower(r.rename_to)
    )) THEN 'reread'
    ELSE r.first_reason
  END AS reason
  FROM ranked r
), counted AS (
  SELECT pattern, reason, CASE
    WHEN reason IN ('fragment', 'fragment_reread', 'rename_duplicate') THEN 'takedown'
    WHEN reason IN ('rename', 'rename_tail') THEN 'rename'
    WHEN reason = 'reread' THEN 'reread'
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
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key, fr.source_document_id
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
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
