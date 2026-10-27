import { feeApplicability } from "@/lib/fee-audience";
import {
  billPayByHeading,
  boxSectionLateFeeRead,
  loanSectionFeeRead,
  payeeReturnedBillPayRead,
  checkingNamePriceAmbiguous,
  extractCandidatesFromText,
  recognizedFeeBullets,
  isUnpricedHeldShape,
  MAX_FEES_PER_DOCUMENT,
  withBoxSizeCellsSplit,
  withSidewaysBoxTable,
  withoutBusinessOnlyFees,
  withoutLeadingFootnoteMark,
  type DroppedLineReason,
  type ExtractedFeeCandidate,
  type ExtractionRulesResult,
  type HeldFeeCandidate,
} from "@/lib/agents/knox/rules";
import { withoutGluedPricePairs } from "@/lib/custom-report/glued-price-pair";
import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "@/lib/agents/knox/families";
import { newestColumnText } from "@/lib/fee-change-columns";
import { namesALimit, namesAWorkedExample, passesDarwinChecks, readsAMeasuredAmount, tidyFeeName } from "@/lib/agents/knox/layout";
import { BOX_CATEGORY } from "@/lib/custom-report/box-size-name";
import { carryColumnHeadingCell, columnHeadingCell, extractTableCandidates, KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";
import { extractAccountTableCandidates, KNOX_ACCOUNT_TABLE_STRATEGY } from "@/lib/agents/knox/account-table";
import { checkFeeAgainstSource, joinLabeledFeeCardText } from "@/lib/custom-report/source-check";
import { rateFeeFromHeld, type RateFeeCandidate } from "@/lib/agents/knox/percent";
import { contextFees, NO_LONGER_CHARGED } from "@/lib/agents/knox/context-names";
import { frequencyFromLine, settledFrequency } from "@/lib/fee-frequency";
import { withoutFeeBullets } from "@/lib/custom-report/fee-bullets";
import { exclusiveStackedPrices, stackedFeePrices } from "@/lib/custom-report/stacked-fee-prices";
import { withoutCardProgramSections } from "@/lib/custom-report/card-program-section";
import { monthlyAccountOwnerReview } from "./monthly-account-owners";
import { withOwnFeeUnit } from "@/lib/custom-report/own-fee-unit";
import { withTierColumnRows } from "./tier-columns";
import { mayHaveSymbolicLesserFee, symbolicLesserOfReview } from "./symbolic-lesser-of";
import { internationalWireEligibility } from "./international-wire-eligibility";
import { belongsToPaidReturnedUnit, paidReturnedUnits } from "@/lib/custom-report/paid-returned-events";
import { withoutGluedSentence } from "./glued-sentence-name";
import { withGluedFootnotePrices } from "@/lib/custom-report/glued-footnote-price";
import { networkColumnReads, withoutNetworkTableRows } from "@/lib/custom-report/network-column-rows";
import { namesLateChargeBound } from "@/lib/late-charge-bound";
import { rateFloorOf } from "@/lib/rate-floor";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { commercialLockboxName, commercialLockboxOnLine } from "@/lib/custom-report/commercial-lockbox";
import { NO_CHARGE_SENTENCE_READ_LIVE, NSF_FAMILY_KEYS, chargesNsfFamily, readNoChargeNsf } from "@/lib/no-charge-statement";

/**
 * Knox's free extraction team, run over one whole document. Pure.
 *
 *   pass 1  extract.rules            line rules (rules.ts)
 *   pass 2  extract.table            table rows: cells, stacked name/price lines (table-rows.ts)
 *   pass 2  extract.family.<family>  fee-family experts over price windows (families.ts)
 *
 * Specialists run in that order and their finds are merged: a later specialist's fee
 * is kept only when no earlier one already has the same category and amount, so a
 * fee read twice is stored once. Each specialist reports its own yield and how many of
 * its fees were new, for the attempt log.
 *
 * Names are tidied first (`tidyFeeName`): table separators, dot leaders, bullets and the
 * unit fragments of neighbouring cells are not part of the name a reader sees.
 *
 * Self-check: before a find is kept, Knox checks it against the line it came from with
 * the shared accuracy check (`checkFeeAgainstSource`, the rule Darwin and Hamilton apply
 * later). A find whose name and price don't trace to one row of the text is held for
 * review as `untraced` instead of going to Darwin, where it would be rejected as not in
 * the source. A later specialist that reads the same fee under a traceable name keeps it.
 */

/** The pass 1 strategy; its version gates re-extraction of a text. */
// v48: a fee-change notice's row ("Fee through | Fee as of") is read at its newest column.
// v49: a monthly fee with no account name takes it from its own name or the heading above it.
// v50: a personal per-item-paid row under an overdraft heading (context-names.ts).
// v51: a monthly fee also takes the balance that avoids it, its waiver and the opening deposit from its account's lines.
// v52: frequency settled by the fill's rule (`settledFrequency`), with fee-frequency v4 wording.
// v53: a fax service is document reproduction, the fold's home for it (`FAX_SERVICE`).
// v54: a copy charged by the page is document reproduction, even under research (`PER_PAGE_COPY`).
// v55: a monthly fee's lineup is never read from a neighbour: the next account's fee line, another
// account's clause of a one-line footnote, or a fee heading above "Money Market" (`lineup.ts`).
// v56: balancing or reconciling a checkbook is account research (`CHECKBOOK_RECONCILIATION`).
// v57: a long table row is traced by its short cells, and a name drops a details cell, an "N/A" cell
// and a leading "Otherwise,"; "to avoid $3 paper statement fee" is named after its price (Arvest, Old National).
// v59: a "Cross-Border Banking" bundle or package is an account, so its fee is the account's
// maintenance fee, not the card's currency fee (`CROSS_BORDER_BUNDLE`; RBC, TD, BMO).
// v60: a threshold parenthetical keeps its figure in the name ("Cashier's Checks ($10,000.01 and Over)"),
// a "Name" column label is dropped, and "In addition to the ... Fee" keeps its words (`nameFrom`, `tidyFeeName`).
// v61: adjusting an ATM deposit or dispute is account research, not a network ATM fee (`ATM_ADJUSTMENT`).
// v62: a dot-leader line's name wrapped over lines above it is read whole (`joinWrappedLeaderNames`),
// "Domestic Outgoing (client only) .... $25.00 per wire" is a wire, and one line read by two
// specialists is one fee (Northern Trust).
// v63: a box size glued after another fee's name starts its own line (doc 20570).
// v64: a box table printed sideways, sizes over prices, is read one box per line (SCCU 8109).
// v65: every read carries a customer audience (`fee_audience`, `audience_evidence`, `fee_treatment`).
// v66 was held for the dropped-lines fix and never shipped; v67 (#1334) took the next bump.
// v67 (#1334): no rule change; every current text is read once more so the dropped-decimal reads
// #1196/#1305 taught the rules pass ("$29. 95" is $29.95, "$1 50*" is $1.50) reach stored pages.
// v68 (#1102): fee-schedule labels with no "fee" or "charge" (research, notary acts, night drop,
// box keys and sizes, extra statements, copies), a "FREE" column beside priced columns, and
// label-and-price rows no rule names held in a fee schedule instead of dropped, with every
// dropped priced line counted by reason.
// v69 (#1102): a price line with no name of its own (a bare "$12", "Outgoing domestic $25") takes
// its name from a short fee heading up to four lines above it, unless a row under that heading
// already read another kind of fee.
// v70 (#1100): monthly maintenance and low-balance fees the account expert missed: a low-balance
// charge named without a fee word and charged by the period, one stated in a sentence ("a low
// balance fee of $6.95 will be imposed every statement cycle"), and a price after a balance word
// that belongs to the figure before it ("Below $500.00 minimum $5.00 per Month").
// v73 (#1100): every monthly maintenance and minimum balance read records the account it belongs
// to: the lineup's product, the account table's column header, the nearest account heading
// (one that names only the kind of account counts), then the fee's own name; null when none does.
// v74: a footnote number glued to the front of a name comes off when the page prints the footnote
// as its own line or cell ("1Monthly fee of $5.95 applies ..." is "Monthly fee";
// `withoutLeadingFootnoteMark`). 35 live fees and 51 raw reads in two days carried one on Oct 16.
// v75: the recurring name families the 62-bank answer key showed held or unread (`RECALL_FAMILY_PATTERNS`:
// rush shipping, mortgage payoff/satisfaction/reconveyance, mortgage processing, club withdrawals and
// short-window closures, wires "within the U.S.", IRA withdrawals and transfers, assisted loan
// payments, skip payments, mobile check deposit), and
// one price for a "debit or credit card" is the debit card's. Every current copy read before v75 is
// read once more (`KNOX_STALE_READ_BELOW_VERSION`).
// v76: the next three recall families on the 62-bank answer key (`rules.ts`): a row pricing each slash
// variant of its fee ("(Online/Manual) | $35/$60") or a box size in two price columns reads every price,
// and a "$ | 5.00" split cell is one price; a free schedule row the line rules never read (dot leader,
// markdown row, "No Cost to Members", "Notary Services: no fee", "No charge for notarization") is held
// at $0 unless it is an allowance; a price that varies ("Check printing prices vary") is held as
// `varies` with no amount. Every current copy read before v76 is read once more.
// v77 (#1398, with `RESEARCH_SPLIT_LIVE` on): returned mail and excess withdrawal lines file under
// their own types (`researchSplitTarget` in rules.ts), not account research.
// v78 (Knox recall round 3, Oct 17; #1304's Knox half): a bill pay read priced under an overdraft
// (courtesy pay) or NSF heading, on its own line or the heading line above, files under that fee
// (`billPayByHeading`), and no later specialist adds it back as bill pay; a bare late fee right after a
// safe deposit box read or under its heading is the box's (`boxLateFee`); a box size before its dot
// leader names the box;
// a checking account's own free row is its monthly fee at $0; and the next name families the 62-bank
// key held (`V78_RECALL_PATTERNS`; statement printouts fold to document reproduction). Every current
// copy read before v78 is read once more (`KNOX_STALE_READ_BELOW_VERSION`).
// v79 (#1827): a price-first row keeps its own price. A table row that opens with its price ("| **$20** |
// Key Deposit |", Valley Strong CU; "$10 | Replacement Debit Card") is the name after it, not the line
// above, so the rows no longer each take the next row's price; under a name that says its price varies
// ("Mortgage satisfaction fee (varies)", Citadel FCU) a price with a name after it is that name's. A
// bare price still goes to the name above, and so does any price under a name that runs on ("...
// Savings Account per"). The stale-read floor stays at v78: no page is read again for this alone.
// v81 (#1830): a later specialist's read of an earlier find's line at its price, named by a part of
// that find's name, is that fee read from its tail and is not kept (`tailOfEarlierRead`): "ACH or Bill
// Pay" from "Stop Payment (check, ACH or Bill Pay) | $25" is no bill pay fee. The stale-read floor
// stays at v78: no page is read again for this alone.
// v82 (round 2 live check, #2123): a combined NSF/overdraft line's twin is stored as its own raw row
// (`line_share`, migration 20270110000065); before, the raw key (document, name, price, audience)
// dropped it. The joined name also matches with the abbreviation in brackets ("Non-sufficient funds
// (NSF) or Overdraft (OD)") and with a returned item for NSF ("Overdraft/Return Item Fee"). The
// stale-read floor stays at v78; only pages with a combined row and no twin are read again
// (`KNOX_TWIN_READ_BELOW_VERSION`).
// v83 (#2151): explicitly labeled, bounded wrapped bullets keep their own terminal price and
// complete conditions. All readers and the source witness share physical ownership, so a
// neighboring paid/returned row cannot donate its price. Stale-read floor remains v78.
// v84 (#2209): bounded returned/paid-item policy paragraphs keep literal tier/exception scope;
// dollar totals of a fee count fail the shared source check. Existing re-read floors stay settled.
// v85 (#2240/#2241): explicit stacked fee labels own their prices; an own annual
// overdraft-program charge stays held instead of losing its period on the paid-item path.
// v86 (#2259): repeated monthly price prose without one literal account owner stays
// eligibility-held; paid and minimal-row callers share the source-bearing writer gate.
// v87 (#2248): new raw lineage keeps literal own charging units and full conditions;
// known special units leave mixed-unit comparisons. Historical raw metadata stays settled.
// v88 (#2021/#2284/#2286): explicit domestic post-price directions bind paired wire
// prices; the same bounded own-price refusal applies to free, paid and live rechecks.
// v89 (#1102): the held-name rules are on (stop pay, reconveyance, early closure, paper
// statements, box sizes, IRA close-outs); returned statements stay held (James's v26 call).
// v90: returned statements file as returned mail (James's decision card, Oct 20, "File them").
// v91 (#1829): a fax-led line ("Fax (Domestic & International)", "Faxes (Domestic only)") reads as
// document reproduction (`FAX_SERVICE`, fold v19); "domestic" there is where the fax goes, not a
// wire. The stale-read floor stays at v78; the fold moves the live ones.
// v93 (#1828): a dot-leader row priced in words ("Reconveyance………… Actual Cost", "Check Orders……
// Prices Vary", "Incoming Wire....... Free") closes its line. It is never a heading or a name for
// the row under it, in the rules or the family passes, and a name never runs on from it
// ("Reconveyance .. Actual Cost: Returned payment" was read at the next row's $4.95, Oregon
// Community FCU, doc 19849; Gunnison's "Wire Fee" $25 never borrows the free incoming wire's
// direction). Follows #2470's v91; #2465 is v94. The stale-read floor stays at v78; name re-tidy
// v24 renames the live names it left.
// v94 (#1827; numbered v92 until #2467 took v93): a cell-less price-first list ("$100.00 Safe
// Deposit Box Drilling/Per Box" / "$14.00 Safe Deposit Box 3”x5”x22”/Year") is read one fee per line when it runs two lines or more and no bare
// price closes it, a range row ("$5-$15 | Levy") never names the row under it, and a heading never
// takes the price of a price-first line that names its own fee. Before, each box took the next
// size's price (Colby, doc 37839) and the levy took the garnishment's $20 (doc 2491). The stale-read
// floor stays at v78; the shared source check (v19) takes the wrong live reads down.
// v95 (#1916; numbered v94 until #2465 took it): a fee never takes the other column's price on a
// two-column page. Advia FCU's "ATM Transactions" and "Garnishment/Tax Levy/Subpoena" took Money Market Checking's "$10.00 monthly for
// average" (the right column's price, flattened onto their name rows), and "Member-Requested ATM/
// Debit" took Account Reopen's $10. The self-check (`checkFeeAgainstSource`, `refusesOtherColumnPrice`)
// now refuses those reads, so they stay untraced holds. The stale-read floor stays at v78; source
// check v20 takes the live ones down.
// v96 (#1810): an account heading with a service mark glued to its last word ("Chase SavingsSM",
// "Chase Private Client CheckingSM 6") reads as the account above a monthly fee (`headingWithoutMark`).
// Before, Chase's $5 Chase Savings fee recorded no account, so the account-type hold never held it
// and it stayed live as checking's "Monthly Service Fee" beside the $25 one. A large bank's page is
// read again once per rules version, so Chase's re-read fills the empty product and the account-type
// hold is the live re-check. The stale-read floor stays at v78.
// v97: a schedule flattened to one long line is read to its end. A cents-only price and its unit
// ("$.40 each") close a dot-leader row, so the next row is not glued to it past the segment limit,
// and a document may hold 1,000 priced segments, not 150, so a schedule printed after a long account
// agreement is reached (Texas key 841: cashier's check, card replacement, early closure, excess
// withdrawal, maintenance and overdraft rows). In a long line, a price with a slash unit ("$35.00/Item")
// ends its row too (State key 60). Texas gate: all 578 -> 590 right, 11 wrong unchanged; held out
// 53 -> 60, 4 unchanged. Seven states: 870 -> 877 right; GA 172 -> 179 right and 9 -> 10 wrong, the new
// wrong read refused by Darwin's verify. The stale-read floor stays at v78.
// v98: the previous row's condition glued in front of a name in a long line ("If the balance falls
// below on any day of the cycle Excess withdrawal", "30 minute minimum Wire transfer outgoing", "and
// minimum Photocopies") is dropped (`withoutLeadingCondition` in `tidyFeeName`). Names only: the shadow
// lab's numbers and the Texas and state gates are unchanged. The stale-read floor stays at v97. Name
// re-tidy stays at v26 (no fleet-wide live rename without a dry-run count).
// v99 (W43 live audit, #2064): a box size read as the whole name ("10x10 Annual Fee", "3 x 10",
// 'Large (10"x10")') filed as a safe deposit box is named "Safe Deposit Box <size>" (`boxSizeNamed` in
// `tidyFeeName`); the shared source check and Hamilton's same-line check read a box's name by the
// row's own words (`asReadBoxName`, `leadsBoxRow`).
// Shadow lab names 287 -> 313 of 317; recall, false publication, Texas and state gates unchanged. The
// stale-read floor stays at v97. Name re-tidy stays at v26.
// v100: a relationship-tier fee table ("PLATINUM GOLD SILVER+ SILVER COLLEGE" over "Stop Payment FREE
// $25 $25 $25 $25", State key 7450) is read one line per priced tier cell (`withTierColumnRows`).
// Knox read only a row's first cell, so a row free in its first tier lost the price the other tiers
// pay. A free cell beside priced ones is a tier perk and gives no $0. Only a header with two
// relationship-tier words arms it, and only for the contiguous table under it. The self-check traces
// the split reads on the unsplit text. Admit-only: a row's first-tier read stays. The stale-read
// floor stays at v97. Name re-tidy stays at v26.
// v101: names Knox read at the key's own price but held unclassified get the category the keys agree
// on (`V101_HELD_VOCABULARY` in rules.ts, tried after every other name rule): bill payer, cash
// advanced, gift and other cards, ACH files and templates, balancing or research, records look-ups,
// a bare account closure, a loan's refinance and a home equity line's early closure. A card's
// expedited order behind a parenthetical "(EFT Service Charge)" is read without the label. Admit-only:
// a name another rule files keeps its category. The stale-read floor stays at v97. Name re-tidy
// stays at v26.
// v102: on a two-column page flattened row by row, a pair whose bare name its column's heading names
// ("ACCOUNT ASSISTANCE | WIRE TRANSFERS" over "... | $100.00 | Domestic Outgoing (branch assisted) |
// $35.00"; "Cashier's Check | Stop Payment | $35.00" over "Customer | $10.00 | ...") is read under
// that heading (`columnHeadingRows`, table pass v9). The table pass read only a line's first pair under
// the last single-cell heading. Admit-only: the rows come after every row the table pass read, and the
// self-check traces them on the stored text. The stale-read floor stays at v97. Name re-tidy stays at v26.
// v103: a row printing its sibling names stacked in one cell over as many prices stacked in the next
// ("Wire Transfer (Within USA) Outgoing Incoming | $20.00 $10.00", State key 9308) reads each variant
// at its own price (`stackedVariantReads` in rules.ts, `stackedCellVariants`). Only one-word
// directions, regions or customer types, as many as the prices, in a two-cell row whose price cell
// holds nothing but the prices; a wire row only when its own stem says domestic. The shared check traces the variant's price on the stored text
// (`stackedVariantIndex` in source-check.ts, admit-only). The row's old read, which named both
// directions and failed Darwin's category check, becomes the first variant's. The stale-read floor
// stays at v97. Name re-tidy stays at v26.
// v104: a read name publish would hold as cut off (`isCutoffName`) only because words that say
// nothing are glued onto the fee's own is cut to those words (`withoutGluedSentence`): another
// column's cell in front, or the row's description after a dash, when every word in it is filler or
// repeats the name (`onlyFillerAndName`); and the subject of a "<what> will cost" sentence. Any
// other word (audience, tier, region, speed, channel, a figure) keeps the name as read and the fee
// held, as at v103 (review of 6dd3641). Names only: categories and prices are unchanged. The
// stale-read floor stays at v97. Name re-tidy stays at v26.
// v105 (#2477): a table row whose name cell a free word already closes ("ATM Transactions……FREE |
// activity……$5", United Bank) is not paired with the next cell's price (table pass v10), and the
// shared check refuses that pairing too (`namesItsClosedFreeRow`, source check v21). Removes reads only.
// The stale-read floor stays at v97. Name re-tidy stays at v26.
// v106 (#1946): a footnote glued to a $0 price ("$0³ or $10" stored as "$03 or $10", North State
// Bank; "$01", Penn Community Bank) is read as $0, never as the footnote's number
// (`withGluedFootnotePrices`), and the shared check reads the same text (source check v22), so the
// $3 read is refused wherever it is made. The stale-read floor stays at v97. Name re-tidy stays at v26.
// v107 (#1443): `isCutoffName` reads its sentence shapes (a verb, a pronoun, an "if"/"when" clause)
// without the closed parentheticals that end the name (`withoutClosedQualifiers`), so "ACH Return
// Item (fee is per item)" and "Notary fee (this service is for members only)" are full names, not
// cut off. An unclosed "(", a parenthetical opening the name, and one with words after it still
// count. v104's glued-sentence cut now runs on fewer names (only ones still cut off), and publish's
// `cutoff_name` hold, Darwin's release review and Deming's name check read the same function. The
// stale-read floor stays at v97. Name re-tidy stays at v26.
// v108 (#1521): `isCutoffName` also reads a name cut before its noun, after a count and an audience
// word ("Counter Check: A blank page of 3 personal", "Daily fee after 5 business"), as cut off
// (`DANGLING_AUDIENCE`, shared with Darwin's live fragment check). Publish's `cutoff_name` hold,
// Darwin's release review and Deming's name check read the same function. On 2026-10-25 it matched
// 2 live fees, 3 verified and 3 raw rows. The stale-read floor stays at v97. Name re-tidy stays at v26.
// v109 (#1828): a bare "Returned payment" row under a loan section's
// title ("Loan fees", "Personal Credit Line fees", "Consumer Loans", "LOANS") is the loan's returned
// payment fee, read as `other_lending_fee` at its own plain price under its own printed name
// (`loanReturnedPaymentRows`, `loan-section-rows.ts`). Before this the row named no category and
// said no fee word, so it was dropped (Oregon Community FCU's "Returned payment…… $4.95", docs
// 13272, 19849, 21634). The nearest title in the row's own column decides: under a credit card,
// checking or other title it stays as before; a short product heading ("Visa") is such a title, and a
// lone title under two side-by-side columns heads neither. Adds reads only. The stale-read floor stays at
// v97. Name re-tidy stays at v27.
// v110 (#1918): a fee named for the checking account itself ("MAX Checking Fee (per month)", "Platinum
// Checking Fee", Bellco FCU) is that account's monthly fee (`CHECKING_ACCOUNT_FEE_NAME`); "$15K" is a
// balance, never a $15 price; and a waiver bracketed inside a name's own cell stops at that cell, so
// the price in the next cell is read. An ambiguous checking-named price (activity-triggered, tiered,
// a percentage, a second price, an opening charge, an "if"/"when" condition, a closure or initial
// deposit, a price per year, quarter, item or debit) is held (`checkingNamePriceAmbiguous`). The name
// pattern is shared with Darwin's category guard (`@/lib/checking-fee-name`) and keeps out opening,
// setup and reopening charges, business accounts and other fees' words (review of #2618). The
// held-line recheck promotes held lines this files, only from a page's current copy; a page's dropped
// line returns when the page is read again. The stale-read floor stays at v97. Name re-tidy stays at v27.
// v111 (#1916): a late charge printed in a safe deposit box section is the box's, whichever
// specialist read it (`boxSectionLateFeeRead`, `boxSectionLateFee` in
// `src/lib/custom-report/box-section-late-fee.ts`). v78's `boxLateFee` read the section only from the
// rules pass's previous read or its segment heading, so Advia FCU's two-column "page | Safe Deposit
// Box 30 Day" / "Courtesy Pay Coverage | Late Payment (by credit union | $10" and 36 more live box
// late fees were still read as a loan's late payment today. The shared check refuses such a fee filed
// as late_payment, so the self-check, Darwin's verify and source check v25 agree. The stale-read
// floor stays at v97. Name re-tidy stays at v27.
// v112 (#1877): a credit union's "Draft Protection Fee" (share-draft wording) is filed as the
// overdraft fee (`DRAFT_PROTECTION_FEE`, shared with guard v89).
// Abbey FCU's "Draft Protection Fee (Paid) per presentment * $30.00" and Members Choice's "Draft
// Protection Fee * | $30.00 per Presentment" were set aside with no category; the held recheck
// re-reads set-aside lines on a version bump, so both go to Darwin. On 2026-10-25 the wording matched
// 4 raw rows at 2 institutions (5827, 8749), none live. Categories only; prices and names are
// unchanged. The stale-read floor stays at v97. Name re-tidy stays at v27.
// v113 (#2070): a fee priced for an account the bank no longer offers is not a current fee. The
// shared check refuses a read whose every row at that price carries the marker on its own row
// ("$5.00 (this account no longer offered)") or sits under a legacy section heading ("Legacy
// Accounts", "Retired Accounts (no longer available on new memberships)") (`discontinuedRow`, source
// check v26), so the self-check holds it as untraced. Removes reads only. The stale-read floor stays
// at v97. Name re-tidy stays at v27.
// v114: a sentence's priced noun phrase ("... to cover overdrafts an NSF fee of $30.00 per item",
// Reliance State Bank, live fee 140283) names and files the price (`pricedNounPhrase` in rules.ts,
// reusing `FEE_OF_SENTENCE`). The cut words "overdrafts an NSF fee" filed it by their first fee word:
// nsf only while a PDF glyph garbled "Overdrafts", overdraft once Rosetta's glyph repair reads it. The
// phrase re-files only between overdraft and nsf, never a paid item's or an overdraft program's NSF
// wording ("NSF items paid: an NSF fee of", "Courtesy Pay overdrafts an NSF fee of" stay overdraft,
// v19/v42/v43); any other disagreement keeps the read (an incoming international wire stays
// international). A generic phrase ("a monthly fee of"), words before it
// that name a fee, or a line no rule reads as a fee keep the read; a cut that drops a condition or a
// family qualifier ("Subpoenas/Summons") keeps the name. A combined "NSF/Overdraft Fee" stays
// overdraft. Oct 25 dry run over 972 live fees whose line or name has the phrase: 217 rules reads
// take the phrase's name (30 differ from the live name), none changes category; with the glyph
// repaired, Reliance alone moves, overdraft to nsf (its live category).
// v115 (#1905): an ATM network table ("Transaction Type | Navy Federal ATM | CO-OP ATM Network® |
// Non-Navy Federal/Non-CO-OP Network ATM | ...", Navy Federal doc 39026; "Item/Service | Non-Owned ATM
// Fee | Owned ATM Fee", R-G FCU) is read by its columns: each row that prices a use of the machine is
// read at the non-network column's price, named by the row and that column ("Share withdrawal at
// Non-Navy Federal/Non-CO-OP Network ATM" $1.00), and no other reader sees the table's rows
// (`networkColumnReads`, `withoutNetworkTableRows`). Before, a row's first price was read whatever its
// column ("Credit card cash advance" at the CO-OP column's $0.50) and the share withdrawal row, the
// account's own non-network fee, was never read. The shared check traces the composed name at that
// column's price only (`networkColumnRow`); guard v91 lets a share withdrawal at another network's ATM
// pass the non-network fee. And a late charge's cap or floor ("maximum late charge of $30 in WV",
// "Minimum Late Fee $10" beside "5% of Payment Amount") is no late fee (`namesLateChargeBound`):
// Darwin's late charge bound re-check (switch on) takes down the 5 live ones. The stale-read floor stays at
// v97. Name re-tidy stays at v27.
// v116 (#1908, #1905): the price rows of a prepaid, payroll, gift or travel card section of a
// general schedule are the card program's, not the account's, so they are left out of the text
// before any specialist reads it (`withoutCardProgramSections`, shared with Darwin's live re-check
// `darwin/card-program-section-check.ts`). Navy Federal's "Prepaid and Gift Cards" / "GO Prepaid
// Cards" rows ("Lost/Stolen Card" $5, "Visa/PLUS Network ATM ... cash withdrawal" $1) were read as the
// account's card replacement and ATM fees on every re-read and taken down by hand three times. A
// card's purchase, issue or reload row stays, and so does a price labelled only by audience, unit
// or purchase ("Members | $3"). Removes reads only. The stale-read floor stays at v97.
// Name re-tidy stays at v27.
// v117 (#1947): a read filed as monthly maintenance whose own line prices it as the paper statement
// charge (`paperStatementRead` in rules.ts, `paperStatementPriceOnLine`, shared with category guard
// v92) is the paper statement fee: "Service charge | $3.00 paper statement fee each statement cycle",
// "A $2 paper statement fee applies", "*A monthly fee of $3 applies if you choose to receive paper
// statements", "Paper (mailed) Statement Fee **** | $2.00 Monthly Fee". The account's own price for
// paper holders beside an electronic price ("$4 for paper statement or $3 for estatement", "$7 with
// paper statement") stays maintenance. Oct 25 dry run: 19 live maintenance fees match, each checked on
// its bank's stored text. The stale-read floor stays at v97. Name re-tidy stays at v27.
// v118 (#1615): a price its own line makes the floor of a percentage charge ("Cash Advance | Either
// $5.00 or 3% of the amount of each cash advance, whichever is greater", "Greater of $10 or 5% of
// Scheduled Pmt", "Merchant Check Cashing (Greater of 10% of Item or $10)") is not a flat fee
// (`rateFloorOf` in `src/lib/rate-floor.ts`, shared with Darwin's rate floor re-check). It is held as
// the percentage, so the rate pass files the rate fee with the floor as its rate_min_amount where the
// category publishes rates (`rateFeeFromHeld` now reads a "$Y or X%" floor or cap stated before the
// rate) and keeps it held elsewhere. Another fee's floor on the same line, a lesser-of cap and a figure
// not joined to the rate by "or" keep the read. Removes flat reads only. The stale-read floor stays at
// v97. Name re-tidy stays at v27.
// v119 (#1443): `isCutoffName` also reads the end shapes on the name without its closing qualifiers
// (`liveQualifiedFragmentShape`, the same function Darwin's live fragment check reads behind its own
// switch), so "Late Fee up to (see schedule)" and "Gift Cards up to (per card)" are cut off: the note
// glued after the cut hid the dangling "up to". It uses the live twin's narrow end words, so "each"
// before a unit note ("Stop payments - each (Draft or ACH)") stays a real name, and leaves out a
// comparative ("Cashier's check more than (sold to MCB customers only)": a threshold figure the price
// read took out, the fee itself whole). On 2026-10-25 it matched 3 live fees and 7 verified rows not live. Publish's `cutoff_name` hold, Darwin's release review and Deming's name check
// read the same function. The stale-read floor stays at v97. Name re-tidy stays at v27.
// v120 (#1513): two category reads that filed a fee under another fee's name.
// - A wire's "Intern.", "Int." (before "Wire"), "Internat'l" or bare "INTL" is international
//   (`abbreviatesInternationalWire` in fee-fold.ts, shared with the source facts in own-wire-scope.ts
//   and the category guard's switched re-file): "Wire Trans. (Intern. Outgoing)" $35 beside "Wire
//   Trans. (Dom. Outgoing)" $18, "Int. Wire Transfer – Outgoing" $40 beside "Wire Transfers –
//   Outgoing" $20. A name that also says domestic ("Dom.") stays domestic. An international wire
//   named before its incoming word ("Intl Wire Transfer – Incoming") is the incoming one.
// - A sentence that prices a titled fee ("..., there will be a $1 Overdraft Transfer Fee.") files
//   under the title when the words before name another category (`titledPriceRead`); the words
//   before stay in brackets when they carry a condition.
// Dry run (Oct 26, read-only, live fees): 2 live domestic wires read international (90381, 90382)
// and 1 live non-network ATM fee is the overdraft transfer (128668), each checked on its stored line. They move only when their banks are next read, each
// still checked by Darwin. The stale-read floor stays at v97. Name re-tidy stays at v27.
// v121 (#1672): a table with no label column, whose header row names one account per column ("Savings
// Account | Checking Account | Money Market | Certificate Accounts | Holiday Account") over rows of
// each account's features, records the account of a monthly fee cell from its own column
// (`unlabelledHeaderColumn` in lineup.ts). Every header cell must name an account, the price row's
// first cell must be a feature cell (a price or "Label: value"), and the price cell must hold the
// fee's own name. Lower East Side People's FCU's money market "No monthly fee ... otherwise $10.00"
// (live 135709) recorded no account and stayed live as checking's fee. Account product only: no fee's
// category or price changes, so the rules re-check this bump replays finds nothing new from it. Oct 26 dry run
// on prod's live no-product monthly fees with a table line (776): the new read names an account for 10,
// 3 of them not checking (135709, 56641, 60745); the account-type hold's column read takes those down
// once switched on. The stale-read floor stays at v97. Name re-tidy stays at v27.
// v122 (#1882): a free read of an overdraft, NSF or continuous overdraft fee whose $0 is not the fee's
// price is held as a range for review (`knox_banded_zero:<kind>`), never sent to Darwin as a free fee
// (`bandedZeroOf` in `src/lib/banded-zero.ts`, shared with Darwin's banded $0 re-check, switch off).
// Three shapes: the $0's own cell goes on to price the fee ("Safety Net Overdraft | $0 if the negative
// balance is $5 or less. $10 if ... $35 per item**"; "Privilege Pay ... | $0 for items ≤ $5"), the same
// name printed on a band row of its own with a price ("Item paid in overdraft fee (Courtesy Pay) | N/C"
// over "Negative account balance $0-$9.99", then "| up to 19.00"), and a price straight after the name
// with the free word the next column's ("Overdraft Fee | $12.00 | Free"). The free read took the first
// figure after the name and tested only the name for a condition (`notAZeroPrice`). A $0 the schedule
// states for the whole fee keeps its read ("No-Fee Overdraft | Free", "Overdraft fee $0 $0 $0").
// Oct 26 dry run over the 139 live $0 fees in those categories: 4 match (99261, 108088, 116439, 149658),
// each checked on its stored text. Removes free reads only. The stale-read floor stays at v97. Name
// re-tidy stays at v27.
// v123 (#1905): a read filed under a deposit category (NSF, overdraft, monthly maintenance, minimum
// balance, dormancy, a returned deposited item) whose every priced line sits in a loan section of the
// schedule is the loan's fee, filed as other lending (`loanSectionFeeRead`, `loanSectionFee` in
// `src/lib/custom-report/loan-section-fee.ts`, shared with Darwin's live re-check
// `darwin/loan-section-check.ts`, switch off). The section is the first non-row line above the fee's
// line: a short heading that names a loan, mortgage, home equity line, HELOC or line of credit, ends on
// a section word and names no deposit, card or business product ("Equity Loan", "Consumer Loan Fees",
// "LOAN FEES", "HELOC - Home Equity Line of Credit"). Navy Federal's "Home Equity Line Check returned
// (due to non-sufficient funds)" $29 and "Tax Service Charge" $25 under "Equity Loan" were read by their
// own words as the account's NSF and monthly maintenance fees and went live (154634, 154635). A row
// naming a deposit account or service, a stop payment and a $0 in words keep their read. Oct 26 dry run
// (prod, read-only): 8 live fees at 7 institutions sit in a loan section under a deposit category. They
// move only when their banks are next read, each still checked by Darwin. Categories only; names and
// prices are unchanged. The stale-read floor stays at v97. Name re-tidy stays at v27.
// v124 (#2079): a fee joined to an earlier find's name after an article ("Overdraft Fee or an NSF Fee
// $30.00") is its own fee when the words before the joiner name a fee themselves (end in fee, charge
// or item, or are a category's name), so the NSF read is kept beside the overdraft as before v81.
// "Copy of a draft or a Teller Check $5" stays one check-copy fee. "&#38;" and "&#x26;" read as "&",
// and square brackets count as parentheses. Adds reads only. The stale-read floor stays at v97. Name
// re-tidy stays at v27.
// v125 (#1094 item 3): a segment holding the schedule's heading phrase or boilerplate ("Fee Schedule",
// "Schedule of Fees", "Truth in Savings", "Member FDIC") is read without the phrase, not skipped whole
// (`readSegment` in rules.ts): a PDF flattened to one line, or "Fee Schedule Overdraft Fee $35 Stop
// Payment $30", lost every fee on it. Each piece between phrases that holds a dollar price is read on
// its own, with capitalised section headings before its first name cut, so the phrase never joins a
// name; a piece with no price yields nothing. A segment that also says "effective" stays skipped whole,
// since it can announce a price not yet charged (R11 on #1094), and so does one whose phrase names an
// audience ("Business Schedule of Fees"), so a business price never reads as everyone's. Only segments holding the phrase read differently. The stale-read floor
// stays at v97. Name re-tidy stays at v27.
// v126 (#1912): a monthly maintenance or minimum balance read with no account from its row, table,
// heading or own name takes, as a last resort, the account its own sentence names as subject ("The
// M&T Preferred Money Market account has a $20 monthly maintenance charge."), on the fee's line or the
// line just above, only when that sentence prints the fee's own price (`accountSubjectProduct` in
// `lineup.ts`). Account product only; names, prices and categories are unchanged. The stale-read floor
// stays at v97. Name re-tidy stays at v27.
// v127 (#1918): a note that a fee is free with an account or condition, or that a few are free
// ("Money Orders (Free with Platinum Checking) | $5.00", "ATM Withdrawals (3 FREE each month) | $3.50"),
// no longer drops the row as "no fee"; the price is read, as waivable (`FREE_FOR_NOTE` in rules.ts).
// An account's own monthly or minimum balance fee with such a note stays the account expert's read.
// And a two-column PDF row whose left price cell was empty on the name's line ("Wire Transfers –
// Domestic | Bill Pay Return Item Fee | $10.00" over "(Free with Platinum Checking) | $20.00 | ...")
// is rebuilt as one row per fee before any line is read (`withShiftedColumnsRebuilt`). The stale-read
// floor stays at v97; Hamilton's rules re-check revisits each live document once for the new
// signature and asks Knox to read again where these rules read a fee that is not live.
// v128 (#1912): a line whose only price is two different prices glued into one cell ("Card Replacement
// .....Share Draft Protest ..... $20.00$10.00", "...(PIN)Wire Transfers (incoming).... $ 2.00n/c*") is
// two flattened columns whose price order is not the names' order, so it reads nothing
// (`gluedPricePair` in `custom-report/glued-price-pair.ts`). The stale-read floor stays at v97; Hamilton's rules re-check revisits
// each live document once for the new signature, and a live fee read only from such a line goes to the
// second look and comes down.
// v129 (#1912, review of #2726): the account-subject read (v126) lets the fee's own line decide. Its own
// line's subject wins over a different one on the line above, and the line above is read only when the
// fee's own line names no account ("Basic Checking: the $5 monthly fee is waived ..." under "The
// Everyday Savings account has a $5 monthly fee." is no longer the savings account's). Account product
// only; the stale-read floor stays at v97.
// v130 (#1912): a heading in a vertically centred merged cell, which the PDF reader prints on the middle
// row of its block only ("Wire Transfers | Outgoing Domestic - Not in Person: $60.00" between "Outgoing
// Domestic: $30.00" and "Outgoing International: $45.00 ..."), names the block's sibling "<name>:
// <price>" rows above and below it too (`withCenteredHeadingCells` in
// `custom-report/centered-heading-cell.ts`, applied by Knox with a fee-family check and by the shared
// source check). "Not in Person" is a channel a heading may qualify, and an international wire whose
// price is followed by "plus <the same wire's> fee" keeps its scope (`own-wire-scope.ts`). The stale-read
// floor stays at v97; Hamilton's rules re-check revisits each live document once for the new signature
// and asks Knox to read again where these rules read a fee that is not live.
// v131 (#1912): a bill pay return whose name says the payee returned it ("Bill Pay Return Item Fee (per
// item returned by payee)", Bellco 85460, its note read from the next line since v127) is filed as bill
// pay, not NSF (`BILL_PAY_RETURNED_BY_PAYEE` in `custom-report/payee-returned-bill-pay.ts`, shared with
// guard v99). A bill pay return with no payee words stays NSF ("Bill Payment Return Item Fee (per
// presentment)", Texas tid 2419). The stale-read floor stays at v97.
// v132 (#1912): a commercial lockbox service ("Lock Box Service, per month" $225, Forte Bank 135270) is
// not a safe deposit box: a lock box name that names the service (processing, items, remittances,
// wholesale or retail) and nothing of a box gets no category (`COMMERCIAL_LOCKBOX_NAME` in
// `custom-report/commercial-lockbox.ts`, shared with guard v100), and any specialist's safe deposit box
// read whose name or stored line or business heading says so is held unclassified. A lock box with a
// size, key, drilling, rent, lease, year or late charge stays a safe deposit box. The stale-read floor
// stays at v97.
// v133 (#2040): a whole sentence saying the bank charges no NSF fee ("We do not charge a returned
// item/non-sufficient funds (NSF) fee for items returned unpaid.") is the NSF fee's $0, held as `zero`
// like a "No Fee" row (`readNoChargeNsf` in `src/lib/no-charge-statement.ts`, shared with the source
// check's witness). Only an unconditional sentence of the shared grammar, whose two sentences before,
// two sentences after, headings in the 40 lines above and nearest section heading name no product,
// account, audience, tier or service, whose next two sentences do not narrow it, on a text where no line
// prices an NSF-family fee and no other sentence names an NSF-family fee or charge at all (refuse by
// default, affirming or not); none when any specialist read an NSF-family fee on the text, or a priced
// read with NSF-family words. The extract step holds the read for review when the institution charges
// an NSF-family fee anywhere (`knox_no_charge_conflict`). Behind `NO_CHARGE_SENTENCE_READ_LIVE` (off):
// until it is switched on, the read is computed only by the dry run and tests, and no text reads it.
// Oct 27 dry run (prod, read-only, current copies, after the third #2753 review): 0 texts at 0
// institutions would read it once on, so none gains a $0 and none is held; the 9 grammar matches are
// all refused, 6 by another NSF fee sentence on the page. The stale-read floor stays at v97.
export const KNOX_RULES_STRATEGY = { strategy: "extract.rules", version: 133 } as const;

export interface SpecialistRun {
  strategy: string;
  version: number;
  pass: 1 | 2;
  /** Fees this specialist found on its own. */
  found: number;
  /** Fees it added that no earlier specialist had. */
  added: number;
  heldFound: number;
  /** Finds dropped by the self-check: name and price don't trace to one row of the text. */
  selfCheckFailed: number;
  candidates: ExtractedFeeCandidate[];
}

export interface FreeExtractionResult extends ExtractionRulesResult {
  runs: SpecialistRun[];
  /** Percentage fees that publish as rates and trace to the text (`percent.ts`); the rest stay held. */
  rates: RateFeeCandidate[];
  /** v68: priced lines no rule names that were neither read nor held, by reason. */
  dropped: Partial<Record<DroppedLineReason, number>>;
}

const MAX_HELD_PER_DOCUMENT = 40;
/** v76: a $0 or "prices vary" hold, untraced $0 rows included, counts in the unpriced half of the held cap. */
const unpricedHalf = (row: HeldFeeCandidate): boolean => isUnpricedHeldShape(row.shape) || (row.shape === "untraced" && row.amount === 0);
/**
 * NSF and overdraft joined as one item's name: "NSFs/Overdrafts", "Overdraft or NSF Item".
 * v82: also with the abbreviation in brackets ("Non-sufficient funds (NSF) or Overdraft (OD) per
 * item") and a returned item for NSF ("Overdraft/Return Item Fee", "Returned Item/Overdraft fee").
 */
const NSF_TERM = String.raw`(?:(?:non[-\s]?sufficient|insufficient) funds?(?:\s*\(nsfs?\))?|nsfs?|return(?:ed)? items?)`;
const OD_TERM = String.raw`(?:overdrafts?(?:\s*\(od\))?|OD)`;
const NSF_AND_OVERDRAFT = new RegExp(
  String.raw`\b${NSF_TERM}\s*(?:\/|\bor\b|\band\b|&)\s*${OD_TERM}(?![\w-])|\b${OD_TERM}\s*(?:\/|\bor\b|\band\b|&)\s*${NSF_TERM}\b`,
  "i",
);
const MAX_UNCLASSIFIED_PER_DOCUMENT = 10;
/** v78: a read's category, and the categories the rules pass re-files it to by its heading (`billPayByHeading`, `boxLateFee`). */
const REFILED_BY_HEADING: Readonly<Record<string, readonly string[]>> = {
  bill_pay: ["overdraft", "nsf"],
  late_payment: ["safe_deposit_box"],
};

function words(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The same fee read by two specialists: same category and price, and the names agree
 * (equal, one quoted in the other's excerpt, or the same first two words). Two
 * different fees that share a category and price ("Paid overdraft item $35" and
 * "Overdraft fee, 2nd and subsequent items $35") are both kept.
 */
export function sameFee(a: ExtractedFeeCandidate, b: ExtractedFeeCandidate): boolean {
  if (a.canonicalHint !== b.canonicalHint || a.amount !== b.amount || a.feeAudience !== b.feeAudience) return false;
  // v62: one source line read by two specialists is one fee, whatever each named it
  // ("Domestic Incoming wire" and "Wire Transfers: Domestic Incoming", Northern Trust).
  if (a.excerpt.trim() === b.excerpt.trim()) return true;
  const nameA = words(a.feeName);
  const nameB = words(b.feeName);
  if (nameA === nameB || words(a.excerpt).includes(nameB) || words(b.excerpt).includes(nameA)) return true;
  return nameA.split(" ").slice(0, 2).join(" ") === nameB.split(" ").slice(0, 2).join(" ");
}

/**
 * v81 (#1830): one source line at one price read twice, the second time by its tail. A family
 * expert reads the words nearest a price, so "Stop Payment (check, ACH or Bill Pay) | $25" came back
 * as "ACH or Bill Pay" filed as bill pay, beside the rules pass's stop payment. On prod (Oct 19, read-only) 38
 * live fees at 35 banks were a later specialist's tail of another live fee read from the same line of
 * the same document at the same price, under another category: "Fax Fee" of "Verification of Deposit by Fax Fee", "Teller Check" of "Copy of a
 * draft or a Teller Check". The earlier find already names the whole row, so the tail adds nothing.
 * Only a strictly shorter name made of whole words of the earlier one counts. Two fees named
 * together at one price ("Returned Check & Stop Payment Fee $30") are both kept: a part the earlier
 * name joins with "&", "and", "or", "/" or "+" outside any parenthesis or bracket is a fee of its own
 * (`joinedFeeName`). No other word marks a part as a fee: one after "on" or "including" ("Stop
 * Payments including ACH and Bill Pay") is dropped only because no joiner comes right before it.
 */
export function tailOfEarlierRead(prior: ExtractedFeeCandidate, later: ExtractedFeeCandidate): boolean {
  if (prior.amount !== later.amount || prior.excerpt.trim() !== later.excerpt.trim()) return false;
  const whole = words(prior.feeName);
  const part = words(later.feeName);
  if (part === "" || part.length >= whole.length || !` ${whole} `.includes(` ${part} `)) return false;
  return !joinedFeeName(prior.feeName, part);
}

/**
 * v124 (#2079): words that name a fee by themselves: they end in fee, charge or item, or are a
 * category's display name ("Overdraft", "Stop Payment"; a bracketed abbreviation is left out).
 */
const FEE_WORD_END = /\b(?:fees?|charges?|items?)$/;
/** "per item", "each item", "one item": a count after the price, not a fee's name (#2711 review). */
const ITEM_QUALIFIER_END = /\b(?:per|each|every|one|an?|the)\s+items?$/;
const CATEGORY_NAMES = new Set(Object.values(DISPLAY_NAMES).map((name) => words(name.replace(/\([^)]*\)/g, " "))));
function namesAFee(text: string): boolean {
  // A trailing abbreviation ("Overdraft (OD)") is left out, as in the category names.
  const bare = words(text.replace(/[([][^)\]]*[)\]]\s*$/, " "));
  if (ITEM_QUALIFIER_END.test(bare)) return false;
  return FEE_WORD_END.test(bare) || CATEGORY_NAMES.has(bare);
}

/**
 * v81: the part (already in `words` form) follows a top-level "&", "and", "or", "/" or "+" in the
 * name. v124 (#2079): or follows such a joiner and an article ("a", "an", "the") when the words
 * before the joiner name a fee themselves: "Overdraft Fee or an NSF Fee" is two fees, "Copy of a
 * draft or a Teller Check" is one. Square brackets count as parentheses; "&amp;", "&#38;" and
 * "&#x26;" read as "&".
 */
export function joinedFeeName(rawName: string, part: string): boolean {
  const name = rawName.replace(/&(?:amp|#0*38|#x0*26);/gi, "&");
  for (let index = 0; index < name.length; index += 1) {
    if (index > 0 && /[a-z0-9]/i.test(name[index - 1]!)) continue;
    const rest = words(name.slice(index));
    if (rest !== part && !rest.startsWith(`${part} `)) continue;
    const before = name.slice(0, index);
    const depth = (before.match(/[([]/g) ?? []).length - (before.match(/[)\]]/g) ?? []).length;
    if (depth > 0) continue;
    if (/(?:[&/+]|\b(?:and|or))\s*$/i.test(before)) return true;
    const article = /(?:[&/+]|\b(?:and|or))\s*\b(?:a|an|the)\s+$/i.exec(before);
    if (article && namesAFee(before.slice(0, article.index))) return true;
  }
  return false;
}

/** The shared accuracy check, as Darwin reads it: a tiered price is the bank's real price for its band. */
function tracesToSource(text: string, feeName: string, amount: number): boolean {
  const result = checkFeeAgainstSource(text, feeName, amount, ".");
  return result.ok || result.reason === "tiered_fee";
}

/** The self-check's verdict: whether the fee traces, and the row it traced to. */
function selfCheck(text: string, feeName: string, amount: number, canonicalHint?: string): { traces: boolean; row: string | null } {
  const result = checkFeeAgainstSource(text, feeName, amount, ".", canonicalHint);
  return { traces: result.ok || result.reason === "tiered_fee", row: result.ok ? result.sourceLine : null };
}

function heldKey(held: HeldFeeCandidate): string {
  return `${held.shape}:${held.canonicalHint}:${held.feeName.toLowerCase()}:${held.amount}:${held.percent}`;
}

/** True when a ")" comes before any "(": the name is the tail of a wrapped line. */
export function closesUnopenedParen(name: string): boolean {
  const close = name.indexOf(")");
  return close >= 0 && (name.indexOf("(") < 0 || name.indexOf("(") > close);
}

/**
 * v33: pass 1 adds fees named by their page context (`context-names.ts`), and a line saying
 * its fee is being eliminated or no longer charged holds no fee for review.
 */
function withContextFees(text: string, read: ExtractionRulesResult): ExtractionRulesResult {
  return {
    candidates: [...contextFees(text), ...read.candidates.filter((fee) => fee.audienceEvidence != null || !NO_LONGER_CHARGED.test(fee.excerpt))],
    held: read.held.filter((row) => !NO_LONGER_CHARGED.test(row.excerpt)),
    dropped: read.dropped,
  };
}

/**
 * v115 (#1905): pass 1 adds each ATM network table row's non-network price (`networkColumnReads`),
 * named by the row and that column, as the non-network ATM fee when Darwin's checks accept it.
 */
const NETWORK_COLUMN_CATEGORY = "atm_non_network";
function withNetworkColumnFees(checkText: string, read: ExtractionRulesResult): ExtractionRulesResult {
  const network = networkColumnReads(checkText)
    .filter((row) => passesDarwinChecks(NETWORK_COLUMN_CATEGORY, row.feeName, row.amount))
    .map((row): ExtractedFeeCandidate => ({
      feeName: row.feeName,
      amount: row.amount,
      frequency: null,
      canonicalHint: NETWORK_COLUMN_CATEGORY,
      confidence: 0.9,
      excerpt: row.row,
      waivable: false,
    }));
  return network.length === 0 ? read : { ...read, candidates: [...network, ...read.candidates] };
}

/** v74: a read name without the footnote number the page glued to its front; the name as read otherwise. */
function unmarkedName(name: string, text: string, institutionName: string | null): string {
  return withoutLeadingFootnoteMark(name, [text], institutionName) ?? name;
}

/**
 * v74: the name tidied, with a leading footnote number cut before the tidy and again after it,
 * since the tidy can leave one at the front ("each | 8Legal Process Service" is "8Legal ..." once
 * its unit cell goes; doc 20097).
 */
function tidyUnmarkedName(name: string, text: string, institutionName: string | null, canonicalHint: string | null): string {
  // v99: only a read filed as a safe deposit box takes the box's name for a bare size.
  const options = { nameBoxSize: canonicalHint === BOX_CATEGORY };
  return unmarkedName(tidyFeeName(unmarkedName(name, text, institutionName), options), text, institutionName);
}

/**
 * v102: an earlier read of the same source line at the same price whose name carries every word of
 * this read's bare cell. A read of another line never counts: it is another cell.
 */
function cellAlreadyRead(read: ExtractedFeeCandidate, prior: readonly ExtractedFeeCandidate[]): boolean {
  const mark = columnHeadingCell(read);
  if (mark == null) return false;
  const cellWords = words(mark.cell).split(" ").filter(Boolean);
  const line = mark.line.replace(/\s+/g, " ").trim();
  return prior.some((earlier) => {
    if (earlier.amount !== read.amount) return false;
    const excerpt = earlier.excerpt.replace(/\s+/g, " ").trim();
    if (!line || !excerpt || !(line.includes(excerpt) || excerpt.includes(line))) return false;
    const named = new Set(words(earlier.feeName).split(" "));
    return cellWords.every((word) => named.has(word));
  });
}

export function runFreeSpecialists(
  sourceText: string,
  options: { institutionName?: string | null; /** v133 (#2040): defaults to the switch, off. */ noChargeSentences?: boolean } = {},
): FreeExtractionResult {
  const institutionName = options.institutionName ?? null;
  // Labeled fee cards ("Fee TypeX" / ... / "Fee$5.00") are read as one row, as the shared
  // check reads them. The self-check runs on `checkText`: the stored text with these layout
  // rewrites (cards, business-only lines, box tables) but not the v100 tier split.
  // v62: a fee footnoted as business-only is no specialist's to read (`withoutBusinessOnlyFees`).
  // v63: a safe deposit box size glued after a fee's name starts its own line (`withBoxSizeCellsSplit`).
  // v64: a box table printed sideways, sizes over prices, becomes one line per box (`withSidewaysBoxTable`).
  // v100: a relationship-tier table's row becomes one line per priced tier cell (`withTierColumnRows`).
  // The self-check traces every read on the text before that split (`checkText`), so a split read
  // must be supported by the stored row itself: "Courtesy Pay $20 $30 ..." at $30 is held untraced.
  // v106: "$03" is a $0 price with its footnote glued on (`withGluedFootnotePrices`, #1946).
  // v116: a card program section's price rows are no specialist's to read (`withoutCardProgramSections`).
  // v128 (#1912): a line whose only price is two different prices glued together reads nothing (`withoutGluedPricePairs`).
  const checkText = withSidewaysBoxTable(withBoxSizeCellsSplit(withoutBusinessOnlyFees(joinLabeledFeeCardText(withGluedFootnotePrices(withoutCardProgramSections(withoutGluedPricePairs(sourceText)))))));
  // v115 (#1905): an ATM network table's rows are read only by their non-network column
  // (`withNetworkColumnFees`); no other reader sees them, so none takes another column's price.
  const text = withoutNetworkTableRows(withTierColumnRows(checkText));
  const legacyText = withoutFeeBullets(text, recognizedFeeBullets(text));
  const windows = priceWindows(legacyText);
  const stackedPrices = stackedFeePrices(text);
  const specialists: Array<{ strategy: string; version: number; pass: 1 | 2; run: () => ExtractionRulesResult }> = [
    { ...KNOX_RULES_STRATEGY, pass: 1, run: () => withNetworkColumnFees(checkText, withContextFees(legacyText, extractCandidatesFromText(text))) },
    // v62: the table pass reads a fee-change table at its newest column too, as the self-check does.
    { ...KNOX_TABLE_STRATEGY, pass: 2, run: () => extractTableCandidates(newestColumnText(legacyText)) },
    // #1100 gap 3: each product's monthly fee in an account comparison table, read by its column.
    { ...KNOX_ACCOUNT_TABLE_STRATEGY, pass: 2, run: () => extractAccountTableCandidates(newestColumnText(legacyText)) },
    ...FAMILY_EXPERTS.map((expert) => ({
      strategy: expert.strategy,
      version: expert.version,
      pass: 2 as const,
      run: () => runFamilyExpert(expert, windows),
    })),
  ];

  const candidates: ExtractedFeeCandidate[] = [];
  const held: HeldFeeCandidate[] = [];
  const seenHeld = new Set<string>();
  const untraced: HeldFeeCandidate[] = [];
  let unclassified = 0;
  const runs: SpecialistRun[] = [];
  const dropped: Partial<Record<DroppedLineReason, number>> = {};
  const countDropped = (reason: DroppedLineReason, count = 1) => {
    dropped[reason] = (dropped[reason] ?? 0) + count;
  };

  for (const specialist of specialists) {
    const run = specialist.run();
    // v78 (#1304): no specialist files a bill payment priced under an overdraft or NSF heading on
    // its own line as bill pay (`billPayByHeading`); the table pass named such a cell by its words.
    // v111 (#1916): every specialist's late fee printed in a safe deposit box section is the box's
    // (`boxSectionLateFeeRead`), read on the self-check's text.
    // v123 (#1905): every specialist's deposit-category read printed in a loan section is the loan's
    // (`loanSectionFeeRead`), read on the same text.
    const found = { ...run, candidates: run.candidates.map((read) => { const next = billPayByHeading(read); return next && carryColumnHeadingCell(read, next); }).filter((read): read is ExtractedFeeCandidate => read != null).map((read) => payeeReturnedBillPayRead(loanSectionFeeRead(boxSectionLateFeeRead(read, checkText), checkText), checkText)) };
    for (const [reason, count] of Object.entries(found.dropped ?? {})) countDropped(reason as DroppedLineReason, count);
    let added = 0;
    let selfCheckFailed = 0;
    for (const read of found.candidates) {
      if (candidates.length >= MAX_FEES_PER_DOCUMENT) break;
      // v102 (review of 081765f): a read named by its column's heading never takes a price cell an
      // earlier read already names ("Money Orders: Customer" $5 beside "Cashier's Checks: Customer").
      if (cellAlreadyRead(read, candidates)) continue;
      // v44: a fee with no frequency takes the one its own line states right after its price
      // ("$6.00 each", "| $28.00 | Per request"); Darwin's eval found 48% of live fees blank.
      // v47: the fee's own row wins over a frequency read anywhere on the line, and one read
      // from another fee's row is dropped ("... per year .. $10.00 | Reverse Stop Payment
      // .. $20.00" gave the $20 fee "annual"); 25 of 131 stated frequencies in the seven-state
      // keys were wrong this way.
      // v52: the same rule as Hamilton's frequency fill (`settledFrequency`), so a period the line
      // never states is dropped on a per-event fee and a per-item reading never lands on a period
      // category.
      // v57: a fee whose own row traces reads its frequency from that row, not from a window
      // that stops at the price ("... four (4) OD fees per day ... | $17.00 | per item" is per item).
      // v74: a footnote number glued to the front of the name comes off (`withoutLeadingFootnoteMark`).
      // v104: words that say nothing glued onto the fee's own (a filler cell in front, a filler dash
      // description, "<what> will cost") come off when what is left names the fee.
      const feeName = withoutGluedSentence(tidyUnmarkedName(read.feeName, text, institutionName, read.canonicalHint), read.canonicalHint);
      // v111 (review of #2622): the tidied name is the one the self-check traces, so a late fee whose
      // name tidying changed is read for its box section again under that name.
      if (feeName !== read.feeName && read.canonicalHint === "late_payment") {
        read.canonicalHint = boxSectionLateFeeRead({ ...read, feeName }, checkText).canonicalHint;
      }
      // v123 (#1905): the tidied name is the one the self-check traces, so a deposit-category read whose
      // name tidying changed is read for its loan section again under that name.
      if (feeName !== read.feeName) read.canonicalHint = loanSectionFeeRead({ ...read, feeName }, checkText).canonicalHint;
      // v131 (#1912): and for the payee's return of a bill payment under that name.
      if (feeName !== read.feeName) read.canonicalHint = payeeReturnedBillPayRead({ ...read, feeName }, checkText).canonicalHint;
      // v132 (#1912): a lock box any specialist filed as a safe deposit box, whose name or own line or
      // business heading names the commercial lockbox service, is no safe deposit box and no type of
      // the 50: held unclassified for review, never filed (`custom-report/commercial-lockbox.ts`).
      if (read.canonicalHint === "safe_deposit_box" && (commercialLockboxName(feeName) || commercialLockboxOnLine(checkText, feeName, read.amount))) {
        const row: HeldFeeCandidate = { shape: "unclassified", feeName, amount: read.amount, amountMax: null, percent: null, frequency: read.frequency, canonicalHint: null, excerpt: read.excerpt };
        const key = heldKey(row);
        if (!seenHeld.has(key) && held.filter(prior => !unpricedHalf(prior)).length < MAX_HELD_PER_DOCUMENT) {
          seenHeld.add(key);
          held.push(row);
        }
        continue;
      }
      const ownPrices = exclusiveStackedPrices(text, stackedPrices, feeName).filter(row => row.amount === read.amount);
      if (read.canonicalHint === "overdraft" && ownPrices.length > 0 && ownPrices.every(row => row.annualProgram)) {
        const row: HeldFeeCandidate = {
          shape: "periodic_program",
          feeName,
          amount: read.amount,
          amountMax: null,
          percent: null,
          frequency: "annual",
          canonicalHint: read.canonicalHint,
          excerpt: ownPrices[0].ownText,
          ownedPolicy: true,
        };
        const key = heldKey(row);
        if (!seenHeld.has(key) && held.filter(prior => !unpricedHalf(prior)).length < MAX_HELD_PER_DOCUMENT) {
          seenHeld.add(key);
          held.push(row);
        }
        continue;
      }
      const checked = selfCheck(checkText, feeName, read.amount, read.canonicalHint);
      const rowFrequency = checked.row ? frequencyFromLine(checked.row, read.amount) : null;
      const frequency = rowFrequency
        ? settledFrequency(checked.row, read.amount, rowFrequency, read.canonicalHint)
        : settledFrequency(read.excerpt, read.amount, read.frequency, read.canonicalHint);
      const candidate = { ...read, ...feeApplicability(feeName, read.excerpt, read.amount), feeName, frequency };
      // v28: a limit is not a price ("Zelle transfer limit | $1,000").
      if (namesALimit(candidate.feeName, candidate.canonicalHint)) continue;
      // v115 (#1905): a late charge's cap or floor ("maximum late charge of $30 in WV", "Minimum Late
      // Fee $10" beside "5% of Payment Amount") bounds a percentage charge; it is no late fee.
      if (namesLateChargeBound(candidate.feeName)) continue;
      // v118 (#1615): a price its own line makes the floor of a percentage charge ("$5.00 or 3% of
      // each cash advance, whichever is greater", "Greater of 10% of Item or $10") is the least the
      // charge can be, not its price. It is held as the percentage, so the rate pass below files the
      // rate fee with this floor as its rate_min_amount (or keeps it held), never a flat fee.
      const floorLine = [candidate.excerpt, checked.row]
        .find((line): line is string => !!line && rateFloorOf(line, candidate.amount, candidate.feeName) !== null);
      const floor = floorLine ? rateFloorOf(floorLine, candidate.amount, candidate.feeName) : null;
      if (floorLine && floor) {
        const row: HeldFeeCandidate = {
          shape: "percentage",
          feeName: candidate.feeName,
          amount: null,
          amountMax: null,
          percent: floor.ratePercent,
          frequency: candidate.frequency,
          canonicalHint: candidate.canonicalHint,
          excerpt: floorLine,
        };
        const key = heldKey(row);
        if (!seenHeld.has(key) && held.filter(prior => !unpricedHalf(prior)).length < MAX_HELD_PER_DOCUMENT) {
          seenHeld.add(key);
          held.push(row);
        }
        continue;
      }
      // v32: a name that closes a parenthesis it never opened ("SCCU for using a non-SCCU
      // ATM) | $60") is the end of the line above, and the price is another column's.
      if (closesUnopenedParen(candidate.feeName)) continue;
      // v32: a worked example's figure is not a price.
      if (namesAWorkedExample(candidate.feeName)) continue;
      // v32: the figure after "is at least" or "Fee on (the)" is a balance or a transaction.
      if (readsAMeasuredAmount(text, candidate.feeName, candidate.amount)) continue;
      if (!checked.traces) {
        selfCheckFailed += 1;
        untraced.push({
          shape: "untraced",
          feeName: candidate.feeName,
          amount: candidate.amount,
          amountMax: null,
          percent: null,
          frequency: candidate.frequency,
          canonicalHint: candidate.canonicalHint,
          excerpt: candidate.excerpt,
        });
        continue;
      }
      // Pass 1 keeps distinct names at one price (its v3 behavior); a later specialist
      // adds a fee only when no earlier find is the same fee.
      const duplicate = specialist.pass === 1
        ? candidates.some(
            (prior) =>
              prior.canonicalHint === candidate.canonicalHint &&
              prior.feeAudience === candidate.feeAudience &&
              prior.amount === candidate.amount &&
              prior.feeName.toLowerCase() === candidate.feeName.toLowerCase(),
          )
        : candidates.some((prior) => sameFee(prior, candidate));
      if (duplicate) continue;
      // v81 (#1830): a later specialist's read of an earlier find's own line at its price, named by
      // a part of that find's name, is that fee read from its tail, whatever category the tail names.
      if (specialist.pass === 2 && candidates.some((prior) => tailOfEarlierRead(prior, candidate))) continue;
      // v78 (#1304): a later specialist's read of a row the rules pass already filed by its heading
      // is that fee again: bill pay under an overdraft or NSF heading ("Courtesy Pay: Check/ACH/Bill
      // Pay Payment"), a bare late fee among a safe deposit box's lines ("Safe Deposit Box Late Payment").
      const refiledByHeading = REFILED_BY_HEADING[candidate.canonicalHint];
      if (
        refiledByHeading &&
        candidates.some(
          (prior) =>
            refiledByHeading.includes(prior.canonicalHint) &&
            prior.amount === candidate.amount &&
            prior.feeName.toLowerCase().endsWith(candidate.feeName.toLowerCase()),
        )
      ) {
        continue;
      }
      candidates.push({ ...candidate, strategy: specialist.strategy });
      added += 1;
    }
    for (const heldRow of found.held) {
      // v76: $0 and "prices vary" holds take their own half of the cap, so a schedule's free rows
      // never push out a priced hold (or the other way round).
      const unpricedHold = unpricedHalf(heldRow);
      if (held.filter((row) => unpricedHalf(row) === unpricedHold).length >= MAX_HELD_PER_DOCUMENT) {
        if (heldRow.shape === "unclassified") countDropped("unclassified_cap");
        continue;
      }
      const foundRow = { ...heldRow, feeName: tidyUnmarkedName(heldRow.feeName, text, institutionName, heldRow.canonicalHint) };
      if (foundRow.shape === "zero" && readsAMeasuredAmount(text, foundRow.feeName, 0)) continue;
      // A $0 row can go live through the rules re-check, so it passes the same self-check.
      const untracedZero = foundRow.shape === "zero" && !tracesToSource(checkText, foundRow.feeName, 0);
      if (untracedZero) selfCheckFailed += 1;
      const row: HeldFeeCandidate = untracedZero ? { ...foundRow, shape: "untraced" } : foundRow;
      const key = heldKey(row);
      if (seenHeld.has(key)) continue;
      if (row.shape === "unclassified" && unclassified >= MAX_UNCLASSIFIED_PER_DOCUMENT) {
        countDropped("unclassified_cap");
        continue;
      }
      seenHeld.add(key);
      if (row.shape === "unclassified") unclassified += 1;
      held.push(row);
    }
    runs.push({
      strategy: specialist.strategy,
      version: specialist.version,
      pass: specialist.pass,
      found: found.candidates.length,
      added,
      heldFound: found.held.length,
      selfCheckFailed,
      candidates: found.candidates,
    });
  }

  // #1918: source-owned compressed actions are two observations, not one invented
  // category name. Keep the original complete row as evidence for unchanged guards.
  // Run this against physical source, before any normalized legacy fragment can own it.
  for (const unit of paidReturnedUnits(sourceText)) {
    if (unit.eligibility === "admit" ? candidates.length + 2 > MAX_FEES_PER_DOCUMENT
      : held.filter(row => !unpricedHalf(row)).length + 2 > MAX_HELD_PER_DOCUMENT) continue;
    for (let at = candidates.length - 1; at >= 0; at--) {
      const row = candidates[at];
      if (belongsToPaidReturnedUnit(unit, row.feeName, row.amount, row.excerpt)) candidates.splice(at, 1);
    }
    for (let at = held.length - 1; at >= 0; at--) {
      const row = held[at];
      if (row.amount !== null && belongsToPaidReturnedUnit(unit, row.feeName, row.amount, row.excerpt)) held.splice(at, 1);
    }
    for (const event of unit.events) {
      const facts = { feeName: event.name, amount: unit.amount, canonicalHint: event.canonicalKey,
        frequency: unit.frequency, excerpt: unit.ownText, ownedPolicy: true as const,
        lineShare: event.lineShare, linkedConditions: [unit.heading, unit.followingContext].filter(Boolean).join("\n") || undefined,
        feeAudience: unit.audience, audienceEvidence: unit.heading, feeTreatment: "charged" as const };
      if (unit.eligibility === "hold") held.push({ ...facts, shape: "eligibility", amountMax: null, percent: null });
      else candidates.push({ ...facts, confidence: .94, waivable: false, strategy: "extract.paid_returned" });
    }
  }

  // v27: one priced line that names both an NSF item and an overdraft ("Non-sufficient
  // funds item (NSFs/Overdrafts) | $33.00 per item") is the bank's price for both.
  for (const candidate of [...candidates]) {
    const twin = candidate.canonicalHint === "nsf" ? "overdraft" : candidate.canonicalHint === "overdraft" ? "nsf" : null;
    if (!twin || !NSF_AND_OVERDRAFT.test(candidate.feeName)) continue;
    if (candidates.some((prior) => prior.canonicalHint === twin && prior.feeAudience === candidate.feeAudience && prior.amount === candidate.amount)) continue;
    if (candidates.length >= MAX_FEES_PER_DOCUMENT || !passesDarwinChecks(twin, candidate.feeName, candidate.amount)) continue;
    // v82: the twin has the line's own name and price, so it needs its own raw key (`line_share`).
    candidates.push({ ...candidate, canonicalHint: twin, lineShare: `twin:${twin}` });
  }

  // #2278: source price support does not establish an international wire's direction.
  for (let at = candidates.length - 1; at >= 0; at--) {
    const read = candidates[at];
    if (!read.canonicalHint.startsWith("wire_")) continue;
    const scope = internationalWireEligibility(sourceText, read);
    if (scope.kind === "not_applicable" || scope.kind === "admit") continue;
    candidates.splice(at, 1);
    if (scope.kind === "hold") held.push({ shape: "eligibility", feeName: read.feeName, amount: read.amount, amountMax: null,
      percent: null, frequency: read.frequency, canonicalHint: read.canonicalHint,
      excerpt: scope.scope.ownText, ownedPolicy: true, lineShare: read.lineShare });
  }
  // #2335: the printed dollar remains supported, but a symbolic charge is not flat.
  for (let at = candidates.length - 1; at >= 0; at--) {
    const read = candidates[at];
    if (!mayHaveSymbolicLesserFee(read.feeName, read.canonicalHint)) continue;
    const formula = symbolicLesserOfReview(sourceText, read.feeName, read.amount);
    if (!formula) continue;
    candidates.splice(at, 1);
    held.push({ shape: "eligibility", feeName: read.feeName, amount: read.amount, amountMax: null,
      percent: null, frequency: read.frequency, canonicalHint: read.canonicalHint,
      excerpt: formula.ownText, ownedPolicy: true, lineShare: read.lineShare });
  }
  // v110 (#1918): a checking account's named fee printed with a condition, a band, a percentage, a
  // second price or an opening charge is held for review, not sent to Darwin as a monthly fee.
  for (let at = candidates.length - 1; at >= 0; at--) {
    const read = candidates[at];
    if (read.canonicalHint !== "monthly_maintenance" || !checkingNamePriceAmbiguous(read.excerpt, read.feeName, read.amount)) continue;
    candidates.splice(at, 1);
    held.push({ shape: "eligibility", feeName: read.feeName, amount: read.amount, amountMax: null,
      percent: null, frequency: read.frequency, canonicalHint: read.canonicalHint, excerpt: read.excerpt,
      ownedPolicy: true, lineShare: read.lineShare });
  }
  const monthlyOwnerReview = monthlyAccountOwnerReview(text, institutionName);
  for (const candidate of candidates) {
    const owners = monthlyOwnerReview(candidate);
    if (!owners) continue;
    candidate.eligibilityReview = true;
    candidate.linkedConditions = [candidate.linkedConditions, owners].filter(Boolean).join("\n\n");
  }
  // #2209/#2259: preserve literal product prices without pooling them into standard benchmarks.
  // This explicit shape is not one of the automatic range/name/source promoters' inputs.
  for (let at = candidates.length - 1; at >= 0; at--) {
    const read = candidates[at];
    if (!read.eligibilityReview) continue;
    candidates.splice(at, 1);
    held.push({ shape: "eligibility", feeName: read.feeName, amount: read.amount, amountMax: null,
      percent: null, frequency: read.frequency, canonicalHint: read.canonicalHint, excerpt: read.excerpt,
      ownedPolicy: true, linkedConditions: read.linkedConditions, lineShare: read.lineShare });
  }
  // v133 (#2040): "We do not charge a returned item/non-sufficient funds (NSF) fee for items returned
  // unpaid." is the NSF fee's $0 when the shared rule lets it stand (`readNoChargeNsf`), held as `zero`
  // like a "No Fee" row so Darwin verifies it. Once per text, and never beside any NSF-family read: a
  // priced or $0 NSF read on the same text is the schedule's own row, and a held line no category took
  // ("Item returned unpaid | $35", unclassified) still prices NSF when its words are NSF words. The name
  // is pinned: a name Knox's tidy would change is not read, so Darwin traces the name the sentence
  // prints. Off until NO_CHARGE_SENTENCE_READ_LIVE.
  const nsfRead = [...candidates, ...held, ...untraced].some((row) =>
    (row.canonicalHint != null && NSF_FAMILY_KEYS.includes(row.canonicalHint)) || chargesNsfFamily(row));
  if ((options.noChargeSentences ?? NO_CHARGE_SENTENCE_READ_LIVE) && !nsfRead) {
    const [statement] = readNoChargeNsf(sourceText).statements;
    if (statement && tidyUnmarkedName(statement.feeName, text, institutionName, "nsf") === statement.feeName &&
      passesDarwinChecks("nsf", statement.feeName, 0) && held.filter((row) => unpricedHalf(row)).length < MAX_HELD_PER_DOCUMENT) {
      const row: HeldFeeCandidate = { shape: "zero", feeName: statement.feeName, amount: 0, amountMax: null, percent: null,
        frequency: null, canonicalHint: "nsf", excerpt: statement.sentence, statedNoCharge: true };
      const key = heldKey(row);
      if (!seenHeld.has(key)) {
        seenHeld.add(key);
        held.push(row);
      }
    }
  }
  // An untraced read is held once, and only when no specialist read the same fee traceably.
  for (const row of untraced) {
    if (held.filter((prior) => !unpricedHalf(prior)).length >= MAX_HELD_PER_DOCUMENT) break;
    const key = heldKey(row);
    if (seenHeld.has(key)) continue;
    seenHeld.add(key);
    held.push(row);
  }
  // A priced line a specialist has since classified is no longer unrecognized.
  const kept = held.filter((row) => {
    if (row.shape === "untraced") {
      return !candidates.some((candidate) => candidate.canonicalHint === row.canonicalHint && candidate.amount === row.amount);
    }
    return (
      row.shape !== "unclassified" ||
      !candidates.some((candidate) => candidate.amount === row.amount && candidate.excerpt.includes(row.feeName))
    );
  });
  // A held percentage in a category that publishes rates, traced to the text, goes to
  // Darwin as a rate fee; the same rate read twice is one fee.
  const rates: RateFeeCandidate[] = [];
  const stillHeld = kept.filter((row) => {
    if (row.shape !== "percentage") return true;
    const rate = rateFeeFromHeld(row, text);
    if (typeof rate === "string") return true;
    const duplicate = rates.some(
      (prior) => prior.canonicalHint === rate.canonicalHint && prior.ratePercent === rate.ratePercent && prior.feeName.toLowerCase() === rate.feeName.toLowerCase(),
    );
    if (!duplicate) rates.push(rate);
    return false;
  });
  const unitHolds = stillHeld.map(row => row.shape === "zero" && row.canonicalHint && row.amount != null
    ? withOwnFeeUnit({ ...row, amount: row.amount, canonicalHint: row.canonicalHint }, sourceText) : row);
  return { candidates: candidates.map(candidate => withOwnFeeUnit(candidate, sourceText)), held: unitHolds, rates, runs, dropped };
}
