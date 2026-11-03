import { feeApplicability } from "@/lib/fee-audience";
import {
  billPayByHeading,
  stopPaymentListRead,
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
import { heldWireClausePrices } from "@/lib/custom-report/wire-clause-prices";
import { FAMILY_EXPERTS, priceWindows, runFamilyExpert } from "@/lib/agents/knox/families";
import { newestColumnText } from "@/lib/fee-change-columns";
import { namesALimit, namesAWorkedExample, passesDarwinChecks, readsAMeasuredAmount, tidyFeeName } from "@/lib/agents/knox/layout";
import { boxLateColumnPrices, boxLateColumnRead } from "@/lib/agents/knox/box-late-column";
import { creditCardSectionColumns, creditCardSectionRead } from "@/lib/agents/knox/credit-card-section";
import { checkFeeCategory, plainReturnBesideNsf, SCHEDULE_NSF_NAME } from "@/lib/fee-category-guard";
import { BOX_CATEGORY } from "@/lib/custom-report/box-size-name";
import { carryColumnHeadingCell, columnHeadingCell, extractTableCandidates, KNOX_TABLE_STRATEGY } from "@/lib/agents/knox/table-rows";
import { extractAccountTableCandidates, KNOX_ACCOUNT_TABLE_STRATEGY } from "@/lib/agents/knox/account-table";
import { checkFeeAgainstSource, joinLabeledFeeCardText } from "@/lib/custom-report/source-check";
import { rateFeeFromHeld, type RateFeeCandidate } from "@/lib/agents/knox/percent";
import { contextFees, NO_LONGER_CHARGED } from "@/lib/agents/knox/context-names";
import { withHeadingCategoryReads } from "@/lib/agents/knox/heading-category-rows";
import { splitHeadingContext } from "@/lib/heading-context-trailer";
import { frequencyFromLine, settledFrequency } from "@/lib/fee-frequency";
import { verifiedFrequency } from "@/lib/agents/darwin/verified-frequency";
import { storedOwnExcerpt } from "@/lib/agents/knox/own-cells";
import { withoutFeeBullets } from "@/lib/custom-report/fee-bullets";
import { exclusiveStackedPrices, stackedFeePrices } from "@/lib/custom-report/stacked-fee-prices";
import { withoutCardProgramSections } from "@/lib/custom-report/card-program-section";
import { monthlyAccountOwnerReview } from "./monthly-account-owners";
import { ownFeeUnit, withOwnFeeUnit } from "@/lib/custom-report/own-fee-unit";
import { withTierColumnRows } from "./tier-columns";
import { mayHaveSymbolicLesserFee, symbolicLesserOfReview } from "./symbolic-lesser-of";
import { internationalWireEligibility } from "./international-wire-eligibility";
import { belongsToPaidReturnedUnit, paidReturnedUnits } from "@/lib/custom-report/paid-returned-events";
import { withoutGluedSentence } from "./glued-sentence-name";
import { withGluedFootnotePrices } from "@/lib/custom-report/glued-footnote-price";
import { bulletItemRead } from "./bullet-cell-rows";
import { networkColumnReads, withoutNetworkTableRows } from "@/lib/custom-report/network-column-rows";
import { discontinuedTablesLive, flagDiscontinuedTables, type DiscontinuedTableFlag } from "./discontinued-tables";
import { namesLateChargeBound } from "@/lib/late-charge-bound";
import { rateFloorOf } from "@/lib/rate-floor";
import { rateBoundOf } from "@/lib/rate-bound";
import { rewardCreditOf } from "@/lib/reward-credit";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { commercialLockboxName, commercialLockboxOnLine } from "@/lib/custom-report/commercial-lockbox";
import { NO_CHARGE_SENTENCE_READ_LIVE, NSF_FAMILY_KEYS, chargesNsfFamily, readNoChargeNsf } from "@/lib/no-charge-statement";
import { withWireChannelClause } from "./wire-channel-clause";
import { readDashListsAsRows } from "./dash-list-rows";
import { withProtectionItemReads } from "./protection-item";
import { freeListItemRead } from "@/lib/free-list-item";
import { withoutColumnLabelEchoes } from "./column-label-echo";
import { withThresholdFigures } from "./threshold-name";
import { dividendThresholdSentence } from "@/lib/dividend-threshold";
import { onlineServiceMonthlyFee } from "@/lib/service-monthly-charge";

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
// prices an NSF-family fee and no other sentence names an NSF-family fee or charge (refuse by default,
// affirming or not, unless the sentence wholly agrees with the $0); none when any specialist read an NSF-family fee on the text, or a priced
// read with NSF-family words. The extract step holds the read for review when the institution charges
// an NSF-family fee anywhere (`knox_no_charge_conflict`). Behind `NO_CHARGE_SENTENCE_READ_LIVE` (off
// here; on since v155): while it was off, the read was computed only by the dry run and tests.
// Oct 27 dry run (prod, read-only, current copies, after the third #2753 review): 3 texts at 3
// institutions would read it once on (Wells Fargo 4, 172, 359); 2 have no NSF row today, 1 already
// shows NSF $0, none is held. Of the 9 grammar matches, 3 more are refused by another NSF fee sentence,
// 2 by the page price test and 1 by scope. The stale-read floor stays at v97.
// v134 (#1912): the international wire direction review (`own-wire-scope.ts`, shared with Knox's
// eligibility hold, Darwin's verify and its live re-check, and Hamilton's publication policy) reads the
// directions banks print another way: "(in/out)", "Wire – Out" (any dash), "International Out",
// "(Out)", "Foreign-In", "Receive", "Outcoming", "Income Wire", a wire "Withdrawal" or "Deposit", and a
// direction in the next cell ("$45.00 | Outgoing"). "Outside U.S." is international and "Non-Domestic"
// is not domestic. A "Wire Transfer Incoming | None" row is a priced row, not a heading over the wire
// below it. The stale-read floor stays at v97.
// v135 (#1912): a wire price whose channel is printed after it on its own line ("$30.00 - phone request",
// "$15.00 Recurring / $25.00 New") keeps that channel in its name (`wire-channel-clause.ts`,
// `withWireChannelReads`), so statistics rule 11 sets the channel price aside beside the general one.
// The new name must trace on the stored text, or the read keeps its old name.
// v136 (#2067): a price its own line makes the minimum or maximum of a percentage charge ("7% Research Fee
// (Minimum charge $5.00", "4% of advance (min. of $5)", "1% of check amount ($2.00 minimum / $15.00 maximum)",
// "Non-Member ($10 Max) | 5% of Total") is not a flat fee (`rateBoundOf` in `src/lib/rate-bound.ts`, shared
// with the source check's `rate_bound` refusal). It is held as the percentage, as v118 holds a floor, so the
// rate pass files the rate fee with the bound as its rate_min_amount or rate_max_amount where the category
// publishes rates and keeps it held elsewhere. A price that stands alone after its own name, a balance
// ("$1,500 minimum balance") and a reward or interest rate ("4% cash back ... maximum of $10") keep the read.
// Removes flat reads only. The stale-read floor stays at v97.
// v137 (#2137): money the bank pays the customer ("2) Earn $50 when you complete two or more online bill
// payments", "To receive up to a $150 bonus", "Submit A Mobile Deposit | $5 reward", "receive a $25 credit
// toward the rental of a safe deposit box", "request a one-time service charge refund of $50") is no fee
// (`rewardCreditOf` in `src/lib/reward-credit.ts`, shared with the source check's `reward_credit`
// refusal). Such a read is dropped unless the self-check traces it to a row that prices it as a fee. A
// figure a fee word follows ("receive a $20.00 late fee") keeps the read, and a bare "receive" or "get"
// never makes a reward without a reward noun in its clause ("Fax / Receive $1.00 per page", "Incoming
// wire: to receive $15.00"). Removes reads only. The stale-read floor stays at v97.
// v138 (#2285): a wire line whose direction prices #2021's clause reader declines (a restricted
// section such as "Business Wire Fees" or "Youth Accounts", or another same-direction price) is held
// as eligibility, each price under its own following clause ("Wire Transfer Fee | $5 on Incoming
// Wires / $10 on Outgoing Domestic" holds Incoming Wires $5 and Outgoing Domestic $10), and no
// legacy reader reads the line again (`heldWireClausePrices` in `custom-report/wire-clause-prices.ts`).
// The price windows named the outgoing $10 by the clause before it ("Incoming Wires" $10). A row
// whose nearest unpriced line above is a business or commercial heading keeps that audience in its
// name ("Incoming Wires (business)"). Nothing new is admitted; adds holds and removes borrowed reads
// only. The stale-read floor stays at v97.
// v139 (#2248): a fee's own page, document, image, statement or time unit is read through the
// separators schedules print between a label and its price: a dash ("Photocopies - $0.75 per page"),
// markdown emphasis ("| ***Photocopies*** | $0.25 per page |"), the fee's own parenthetical floor or
// cap ("$0.50 per page ($2.50 minimum)") and a slash inside its own label ("Account Printout /
// Statement / Fax / Check Copy | $1.00 per Page", no longer a "/statement" conflict). The price is
// unchanged; only the unit and its own clause are kept, so the row leaves mixed-unit comparisons.
// Darwin's frequency fill reads the same line the same way (`specialUnitOnPriceLine`). New reads
// only: same-document raw conflicts keep their old metadata. The stale-read floor stays at v97.
// v140 (#2248 review): a unit only in the fee's name ("Research Copies (Per Page)") no longer
// overrides an explicit per-event basis after its price ("| $5.00 per request", "$5.00 per item",
// "/transaction"): the line's own basis wins and no unit is kept (`specialUnitOnPriceLine`, shared
// by `ownFeeUnit`, Darwin's frequency fill and the own-unit re-check). "each" names no basis and
// keeps the name's unit. Removes unit metadata only; prices and categories are unchanged. The
// stale-read floor stays at v97.
// v141 (inst 608): an account heading that opens on its own number ("360 Checking", "50+ Checking",
// "55 Plus Checking") is read as the account above its fees (`distinctAccountName`). Before, its
// digits read as a price or footnote, so the lookback ran past it to the account above ("Gold
// Checking" took 360 Checking's $8.00 fee). Changes account names only; prices and categories are
// unchanged. A numbered line naming an account word owns its fees; a numbered feature
// line ("24 Hour Account Access", "25 Checking Accounts") is skipped; any other numbered line stops with no account.
// New reads only; Darwin's account-owner re-check (`account-owner-check.ts`) re-reads live
// fees. The stale-read floor stays at v97.
// v142 (Oct 30): a monthly maintenance fee never keeps a per-item frequency (`settledFrequency`,
// `INHERENTLY_PERIODIC_KEYS`): Knox passed its own per-item reading of the line in as the stated
// frequency and the rule kept it, so 17 live maintenance fees were per item ("A service charge of
// $3.00 will be charged each calendar month"). "each calendar month", "each statement period" and
// "each calendar quarter" now read as periods. Frequency only; prices and categories are unchanged.
// The stale-read floor stays at v97.
// v143 (Hamilton proof run, Oct 30): a price whose own sentence names no fee no longer takes one
// from an earlier "no ... fees" sentence (`priceAfterNoFeeSentence`, rules pass and family experts):
// ESL FCU's "$1 deposit" was a $1 monthly fee. An overdraft name priced per transfer ("Overdraft |
// $5.00/Transfer") and "Overdraft (OD) Protection" are the overdraft protection transfer
// (`overdraftPricedPerTransfer`, rules, table v11 and family passes): Flagstar's linked-account
// transfer was an overdraft fee at $0. The stale-read floor stays at v97.
// v144: an NSF name that prices a bounced loan, mortgage or lease payment is the loan's servicing
// fee, filed as other lending: Global FCU's "» NSF mortgage payment: Additional Cenlar charge"
// $25.00 (docs 1940 and 19930), the charge its mortgage subservicer adds, went live twice as the
// credit union's NSF fee (67831, 67818), and 30 such reads at 16 institutions in all were filed
// NSF ("NSF Loan Payment" and the like failed the NSF guard's "loan" word and never went live). One price for the account's items and a loan
// payment ("NSF check/Loan Payment", "Nonsufficient Funds Loan Payment, Returned Check") stays NSF
// (`loanPaymentNsfName`, shared with the category guard's switched re-file). The stale-read floor
// stays at v97.
// v145 (#2072, Oct 31): `KNOX_REREAD_PUBLISHED_NAME_LIVE` turns on (James's yes on the decision card).
// Re-read requests are settled once per rules version, so the bump reads the settled ones again and
// the 5 kept-live fragments the dry run names take publish's full name. No rule changes; the
// stale-read floor stays at v97.
// v146 (#2064): a dollar cap on a day's overdraft or NSF fees is read in the other ways schedules print
// it (`daily-fee-cap.ts`, the overdraft family v6): named after its figure ("$30.00/item ($150.00 max
// daily)"), its own line under the fee it caps ("4 item cap per day (max fee of $120/day)"), "Daily
// maximum" after the per-item price, and a sentence that names the fees it caps. `refusesDailyCap`
// (shared with the source check) refuses another service's limit, a sustained or "after N days" charge,
// a per-item price and a limit no fee word governs; the cap is two to twelve of the fee it caps. The
// shared check's wider cap trace is behind `DAILY_CAP_LINES_LIVE` (on since 2026-11-02), so with it off Knox's new reads
// publish only where main's trace already finds them (State key 2017, live audit 75); the rest are held
// untraced. Admit-only. The stale-read floor stays at v97.
// v147: a counted free allowance joined to the price after it ("3 free per month (then $1.50 per)", "First 5
// pages free, then $0.50 per page", "4 sheets free (then $2.00 per sheet)") no longer drops the row as "no
// fee": the price is read, waivable and per item, named without the allowance (`FREE_ALLOWANCE_THEN` in
// rules.ts). A free stretch of time ("first 6 months free"), an allowance with no "then" joining it to the
// price, and a price a deposit, balance, minimum, limit or requirement follows stay dropped. Admit-only;
// the shared check is unchanged. The stale-read floor stays at v97.
// v148 (#1092): a price-first list that puts a dash between each price and its name ("$25.00 - NSF
// Check/ACH/ATM item", State key 10272) is read as the label rows it lists ("NSF Check/ACH/ATM item |
// $25.00", `dash-list-rows.ts`), so each fee takes its own line's price, not the next line's, and every
// field is base's read of that row. Only a run base's own price-first test accepts, not under a fee's
// name, whose row reads all trace to the stored text. Admit-only: with `DASH_LIST_ROWS_LIVE` off (it is on since 2026-11-02)
// base's whole reading is kept and a row read is added only from a run base reads nothing from, for a
// name base does not read, at a category and price base does not read, so 10272 reads as on main and its
// wrong live $35 single check stays (#1092 line). The
// full rewrite, which replaces base's reads of the run, is behind the switch. The shared check is
// unchanged. The stale-read floor stays at v97.
// v149 (#1100): a named service's own monthly charge ("Bill Payer (monthly fee) | Free", "OLB Monthly
// Maintenance | $0.00", "Remote Capture Monthly Fee - $50.00", "VISA/MasterCard Monthly Fee") is not
// the account's monthly maintenance fee (`serviceMonthlyTarget`, shared with guard v102): a bill payer's
// is bill pay, a mobile check deposit's is mobile deposit, the rest stay held. A service named only in a
// waiver stays the account's. The stale-read floor stays at v97.
// v150: a bare "Overdraft Protection" line priced per item, or with no unit, is the paid-overdraft
// fee when the same schedule prints its own overdraft transfer line and no other read is the overdraft
// fee (Alcose CU 51252: "Overdraft Transfers $2.00" / "Overdraft Protection $30.00 per item";
// `protection-item.ts`). A per-transfer, per-use or periodic unit, or another overdraft fee on the page,
// keeps it the transfer, as v143 reads it. The price is never the signal. Darwin's live re-check
// (`protection-item-refile-check.ts`) re-files the live ones behind an off switch. The stale-read floor
// stays at v97.
// v151 (#2137, Nov 1): a fee's reimbursement, refund or rebate, or a credit toward a fee, is money paid to
// the customer ("$500 appraisal fee reimbursement for new mortgages", "$35 annual fee credit towards the cost
// of a safe deposit box", "will be reimbursed up to $15.00"; `rewardCreditOf` v2), even with the fee's name
// between the figure and the word, and a held read at one is dropped like a candidate. A refund of the
// account's own service charge repays it at its own price and keeps the read ("Earn a $7 service charge
// refund", inst 3161). Drop-only. The shared check's refusal stays behind SOURCE_CHECK_REWARD_CREDIT (off);
// source check v29 counts 9 live fees (Nov 1 dry run). No replay. The stale-read floor stays at v97.
// v152 (#1905): a fraction glyph names a part of an hour after the price ("Checkbook balancing (repeated)
// | $5.00 (per ½ hour)", Navy Federal doc 41267; "$25.00 per ½ hr.", "$10.00 per ¼ hour"), so the own-unit
// pass (`specialUnitAfterPrice` in fee-unit.ts) keeps per_half_hour or per_quarter_hour, not a flat price.
// A "½ hour minimum" is still no unit. The shared check is unchanged. The stale-read floor stays at v97.
// v153 (#2854): a loan's payment example is never a charge (`loanPaymentExample` in rules.ts, rules pass
// and family experts): a price right after "estimated payment of", "estimated monthly payment of",
// "monthly payment of", "60 monthly payments of", "total of payments" or "amount financed", or followed by
// "per $1,000 borrowed" or (after payment words) "for 60 months". Pelican's sample-loan payments
// (institution 7482, "Loan Documentation Fee, estimated payment of $1,473.89") went live as
// other_lending_fee (141052-141055). A fee word between the payment words and the price keeps the
// price (skip-a-payment, late payment, prepaid finance charge). Drop-only; Darwin's live re-check is
// `darwin/loan-payment-example-check.ts`. The shared check is unchanged. The stale-read floor stays at v97.
// v154 (#2040): the no-charge NSF read (`readNoChargeNsf`, v133) refuses fewer pages for clauses that name
// an NSF fee without pricing it: a table of contents' entries (no NSF price, no NSF sentence), an amount
// of $1,000 or more (a funds-availability limit, never an NSF price), the recoverable-loss clause for an
// unauthorized withdrawal ("fees that were charged as a result of the withdrawal (for example, NSF
// fees)"), a merchant's electronic returned check charge, the "fees, losses, or damages you may incur"
// liability disclaimer and the posting order's "overdraft fees". Still behind NO_CHARGE_SENTENCE_READ_LIVE
// (off), so this version changes no read. Nov 1 dry run (read-only, current copies, switch on): United
// Bank (67, doc 24430) joins Wells Fargo 4, 172 and 359; none is held.
// The stale-read floor stays at v97.
// v155 (#2040, Nov 2): no rule changes. NO_CHARGE_SENTENCE_READ_LIVE turns on under the sampled-clean
// rule (Nov 1 dry run on current copies: 4 texts at 4 institutions read NSF $0, Wells Fargo 4, 172 and
// 359 and United Bank 67, each traced by `checkFeeAgainstSource`, none held), and the bump reads current
// copies again so those sentences are read. Source check v30 re-traces live fees with the witness on.
// The stale-read floor stays at v97.
// v156 (#2248, Nov 2): a free allowance's period is not the price's unit ("Copies of Checks (per statement;
// 2 free per statement cycle) | $2.00" is $2 a copy, live 98831), and one price naming two units
// ("$5.00/statement or document copy", "(per statement/document)") names none (`specialUnitAfterPrice` in
// fee-unit.ts). A free count of the same unit keeps it ("$2.00/Page, First 2 pages free" is per page).
// The shared check is unchanged. The stale-read floor stays at v97.
// v157 (#1397): a $0 that is an
// item in one named account's list of benefits ("PremiumSpend Checking Account owners are provided the
// following free services: ..., free incoming domestic wire transfers", "As long as you have an active
// Relationship Rewards Checking account, the following fee waivers will be offered: ...; No fee for
// incoming wires", an account's feature list) is held as a range for review, never sent to Darwin as a
// free fee (`accountBenefitZeroOf` in `@/lib/account-benefit-zero`, flag `knox_account_benefit_zero`).
// That account's perk is not the bank's price. Darwin's verify refuses it and its live re-check reads
// what is already live. The stale-read floor stays at v97.
// v158 (Nov 2, prod sample fee 95508): a wire its own words send outside the U.S. without saying
// "international" ("Outgoing wire transfer fee (if transfer will not be initially processed through a
// U.S. bank) | $50.00", Bank Orion 1399; "Out of USA", "Non U.S.") is read as the international wire
// (`wireOutsideUsWords` in fee-fold.ts, shared with category guard v103, which re-files what is live).
// The affirmative "(if transfer will be initially processed through a U.S. bank)" stays domestic. The
// shared check is unchanged. The stale-read floor stays at v97.
// v159 (Nov 2, prod sample fee 16734): a non-network ATM label that opens with the bank's own all-capitals
// abbreviation and "ATM" ("Cash withdrawals | UNFCU ATM fees in Nairobi" $2.00, United Nations FCU) is the
// bank's own machine, not another network's, and is not filed as atm_non_network (`ownInstitutionAtm` in
// `@/lib/custom-report/own-institution-atm`, shared with the category guard v104). "At Wells Fargo ATMs"
// was already read so; a label with no "at" was not. A network or card word, a label that says the machine
// is someone else's, or a label or line that says the bank's ATM is free stays. The shared check is
// unchanged. The stale-read floor stays at v97.
// v160 (Nov 2, prod sample fee 89920): a figure inside a worked example that no fee word owns is never a
// charge (`inWorkedExample`, `examplePriceNotAFee` in rules.ts; drop reason `worked_example`). Community
// Choice CU (7751) explains overdraft protection with "The following example illustrates ...:" / "Assume
// your ... balance ... is $10. ... we may elect to transfer the $10 in your designated linked account";
// the $10 went live as an overdraft transfer fee. An example that quotes the bank's own price ("charged an
// overdraft fee of $25") keeps it, and a leader or table row ends the example. Drop-only; Darwin's live
// re-check is `darwin/worked-example-check.ts`. The shared check is unchanged. The stale-read floor stays at v97.
// v161 (#1092; v157-v160 are #2894, #2926, #2927 and #2928's): names Knox held as unclassified, or did not read, that the taxonomy
// and DECISIONS already place (`V161_HELD_NAME_VOCABULARY` in held-name-vocabulary.ts, tried after
// every other name rule): a skipped loan payment (other lending), a loan's re-amortization, a
// payoff's processing, a foreign check's acceptance
// (collection item), an immigration letter, proof of funds and a mortgage's verification, a
// title the name ties to a vehicle and a DMV filing (vehicle title); a bare title fee stays held (it needs
// section structure, #2872). Admit-only: over every frozen text no
// read main makes changes. The paths that correct live fees read without it while
// `HELD_VOCABULARY_RELABEL_LIVE` is off. The stale-read floor stays at v97.
// v162 (Nov 2, W45 live check, Citizens Savings Bank IA 3416, text 36274; v161 is #2888): a fee name that opens with an
// automatic transfer into checking is the overdraft protection transfer (`AUTOMATIC_TRANSFER_TO_CHECKING`
// in fee-fold.ts, shared with category guard v105). "Automatic Transfer of Funds to a Checking Account-
// $3.00*" named no category and no fee word, so it was dropped (`no_fee_word_not_table_row`);
// "Automatic Transfer of Funds from Savings to Checking (for overdraft protection)" was read as the
// overdraft fee; "Automatic transfer from savings to checking | $3.00" was read as the transfer but the
// guard refused it for naming no overdraft. A two-way service ("Automatic Transfer to Checking or
// Savings", "... Savings to Checking or Checking to Savings"), a transfer out of checking and a name that
// only mentions the transfer later stay out. The bump re-reads stored texts. The shared check is
// unchanged. The stale-read floor stays at v97.
// v163 (#1092, shadow lab Nov 2; v162 is #2932's): a $0 whose own line is no priced row is held as a range for review,
// never sent to Darwin as a free fee (`zeroWaiverRowOf` in `@/lib/zero-waiver-row`, flag
// `knox_zero_waiver_row`): a "No fee for ..." sentence that is one item of a list of free items ("2 Boxes
// Personal Checks Free per Year" / "No Fee for Cashier's Checks"), or the balance row that avoids a fee
// ("Minimum Balance required to avoid a Service Charge / FREE"). The same sentence under its fee's own
// heading ("Notary Service" / "No charge for notarization of Bank documents.") stays the bank's $0.
// Darwin's verify refuses it and its live re-check reads what is already live. Reads are unchanged; the
// shared check is unchanged. The stale-read floor stays at v97.
// v164 (live-source audit draw 275762, Nov 2, Steel Valley FCU 6230, text 12240): a read whose own line has a
// later cell opening with a list bullet and words, the line's price at or after it and none before it, and
// whose name opens with the cells before the bullet, takes the name the bullet's item reads alone at the same
// category and amount (`bulletItemRead`). Those cells are another column's text: prose ("Rate Schedule. The
// Dividend Period is ... If you | • Photocopy Fee ....$5.00/Copy", live as 54298 named "... If you | Ph"
// once the 120-character limit cut its own words), a feature bullet or a heading of the next column
// ("Abandoned Property | • Teller Check | $2.00"). A rename only: the lines stay in place (review of #2952:
// moving them invented a $5 IRA fee on a page whose left column is a wrapping bullet list, text 13895).
// Cells that name the read's category or an audience, an item that reads no such fee alone, a bare bullet
// cell, a first-cell bullet, a price before the bullet and an account's own fee keep the name. The bump
// re-reads stored texts. The shared check is unchanged. The stale-read floor stays at v97.
// v166 (Knox re-read backlog dry run, Nov 2; v165 is #2953's): three reads today's rules made from
// stored texts the backlog would re-read, each against the bank's own line. A wire row whose subject is
// the bank's notice of the wire ("‐Incoming Wire Transfer Email Notification ... No Fee", Intercredit
// Bank 827, beside its $15 and $50 wires) is held, not filed as the wire at $0 (`wireNotificationName`).
// Mobile banking's and hold mail's own monthly charges ("Mobile Banking Monthly Service Charge | No Fee",
// BAC Community Bank 1265; "Hold Mail – monthly fee | No Fee") are named services, held like online
// banking's (`SERVICE_MONTHLY_CHARGE_NAME` v2), not free checking. Reactivating an account ("Account
// Reactivation (check or savings closed for less than 3 months)" $10, Midwest Heritage 1839) is the
// dormant account fee: its closure window had matched the short-window early closure rule first
// (`accountReactivationName`). Guard v106 holds the same names; Hamilton's guard re-check takes the four live
// wire notices down and moves one reactivation fee onto its live dormant twin. The shared check is unchanged. The stale-read floor
// stays at v97.
// v167 (K1, James's Nov 2 missing-fee review; v165 is #2953's, v166 #2957's: River City Bank GA 2037,
// Special Metals FCU NY 5956, Mountain Star FCU TX 4467): clean name-and-price rows no rule filed. The table pass (extract.table v12)
// holds a clean row no rule names as unclassified instead of skipping it with no count, and counts any
// other such row (`table_row_no_category`). A price cell with a short note holding no other figure
// ("$4.00 (returned deposit item – per item)") is a label-and-price row (`priceOnlyCell`). The held-name
// vocabulary (`V161_HELD_NAME_VOCABULARY`, tried after every other rule) files late loan payments, charged
// back checks, image statements, coin deposits, transaction copies and reprinted statements, a savings
// withdrawal fee or money market excess check under types
// the taxonomy already has (category guard v107 accepts the two names it refused). Admit-only: the live
// correction paths read without the vocabulary while `HELD_VOCABULARY_RELABEL_LIVE` is off. An
// instant-issue card and a protest fee stay held: the answer keys leave both unfiled. The table pass's
// unclassified holds are admitted after every specialist, so they never take another reader's place
// under the unclassified cap. The bump re-reads stored texts. The shared check is unchanged. The
// stale-read floor stays at v97.
// v168 (second Knox re-read backlog dry run, Nov 2; v167 is #2958's; the free-list check follows as v169): four classes
// the dry run found among 214 new rows from 40 backlog texts, each wrong on the bank's own line. A box
// table's late-fee column ("BOX SIZE | ANNUALLY | LATE FEE" over "3” x 10” x 24” | $35.00 | $6.00", Eglin
// FCU 5451) is no second rent (`boxLateColumnRead`), and a three-dimension size cell glued after another
// fee's name starts its own line ("COINSTAR® Coin Counting Service | 10” x 10” x 24” | $105.00",
// `withBoxSizeCellsSplit`). A free word that is advice in a "Ways to Avoid" section ("Reconcile online for
// FREE", Financial Health FCU 6465) is held (`zeroWaiverRowOf`, `avoid_fee_advice`). A plain returned check
// charge beside the page's own higher NSF read is the returned deposited item (`withReturnBesideNsf`, the
// guard's v22/v23 rule; First Financial Bank 624). A wire's confirmation is its notice
// (`wireNotificationName`; Century FCU 7131). Guard v108 refuses the confirmation and the glued box size
// live. The shared check is unchanged. The stale-read floor stays at v97.
// v169 (#1092, James's Nov 2 review, Mountain Star FCU 4467, text 36365; v167 is #2958's, v168 the
// second backlog dry run's fix): a priced read whose name is an item of a "free services" list ("Other
// Free Services: Anytime, Notary" / ... / "Check Writing, Balance Inquiries," / "Money market | Fax
// Service" / "$5.00") and whose price the self-check found on another line is held untraced, never sent to Darwin (`freeListItemRead` in `@/lib/free-list-item`, on the
// line the shared check traced; dropped reason `free_list_item`). Live as 159428 "Fax Service" $5: the $5.00
// is the left column's money market excess check price. The shared check already ends a row at another name
// between a name and its price, and never prices a line that says free from below; here the other label is a
// cell of the name's own line and the free word is on the list's heading. Darwin's verify refuses it and its
// live re-check (`darwin.free_list_item`, FREE_LIST_ITEM_TAKEDOWN_LIVE off) reads what is already live. Drop
// only. The shared check is unchanged. The stale-read floor stays at v97.
// v170 (Knox re-read backlog dry run 3, Nov 2; four wrong reads of 40 stored texts, each against the bank's
// own line). (1) A heading cell the page repeats inside each row's cells ("Returned Check (Service / Item) |
// $10 (Fee) | Per item (Terms/Conditions)" under "Category | Service / Item | Fee | Terms/Conditions",
// River Town FCU 6757) is stripped before any reader sees the line (`withoutColumnLabelEchoes`): the label
// kept the plain returned check NSF beside the page's $25 NSF, and "Statement Copy (Service / Item)" filed as
// check_image. (2) The balance a rate disclosure says earns no dividend ("If your average daily balance is
// below $100.00 ($5.00 for accounts held by those under 18 years of age), no dividends are earned",
// Peninsula Community FCU 4447) is no fee (`dividendThresholdSentence`, dropped reason `dividend_threshold`).
// (3) A monthly service fee printed in a section of online, electronic or digital services ("Online Fees" /
// "Cinfed Connection Monthly Service Fee | FREE", Cinfed FCU 6561) is that service's charge, not monthly
// maintenance (`onlineServiceMonthlyFee`, dropped reason `online_service_monthly`). (4) A figure a comparison
// word ties to the name outside parentheses ("Cashier's Check more than $1,000 (MCB customers only)",
// Morton Community Bank 273) is put back into the name after every reader (`withThresholdFigures`, a rename
// only, kept where Darwin's checks still pass), so the shared check finds the row.
// Darwin's verify refuses (2) and (3), and its live re-check (`darwin.not_account_fee_line`,
// NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE off) reports the live ones (Nov 2 dry run: 73916 and 152003 of 493
// candidates). The shared check is unchanged. The stale-read floor stays at v97.
// v171 (Knox re-read backlog dry run 4, Nov 3; two wrong and four doubtful reads of 40 stored texts, each
// against the bank's own line). (1) A short "Stop Pay" is the stop payment ahead of the check, money order
// and draft rules (`STOP_PAY_SHORT` in rules.ts, read while the held-name rules are on): Northwest Missouri
// Regional FCU's "Counter Check Stop Pay Fee (per check) $25.00" filed as counter_check. (2) A list of free
// items one per line is no stacked table (table v13, `freeItemList`): O'Bannon Banking Co's "Special Rates
// on one Safe Deposit Box" took the next item's "Free" ("Free Photocopies (limits may apply)"), and "Free
// Bill Pay" / "Free Online Statements and Check Images" read as $0 fees the same way. An item under "This
// account also includes:" and a perk an account's own cell of a comparison table prices free ("Checks | 1st
// order of starter checks FREE ... (FREE Checking)") are one account's benefit (`accountBenefitZeroOf`,
// held, never sent to Darwin as a free fee). (3) An item named insufficient with no "funds" ("| ACH -
// Insufficient | $ 30.00 |", Four Corners FCU) is the page's NSF row (`ITEM_INSUFFICIENT`), so its plain
// "Returned Check | $ 25.00" is the deposited item return (`withReturnBesideNsf`), as live 149144 files it.
// Darwin's account-benefit re-check v2 reads the two new benefit shapes (DARWIN_ACCOUNT_BENEFIT_ZERO_LIVE
// off; Nov 3 dry run: 308 candidates, the same 12 matches as v1, none new). The shared check is unchanged.
// The stale-read floor stays at v97.
// v172 (Knox re-read backlog dry run 5, Nov 3; six wrong reads of 40 stored texts, each against the bank's
// own line). (1) A statement's copy priced per item is document reproduction (rules.ts, the copy-of-item
// check_image rule skips a copy a statement word opens): Epb Employees FCU's "Statement Copies Per Item | $1".
// (2) A charge named for the low or minimum balance is the minimum balance fee ahead of the "service charge"
// rule (`LOW_BALANCE_CHARGE`): Citizens Bank of Ada's "A low balance service charge of $7.50" went live as
// monthly maintenance and as minimum balance from one line. (3) A label whose price is followed by the fee's
// own name ("Account Fees: $4.95 Monthly Service Charge.") never borrows the heading above in the family
// experts (families.ts, `feeNamedAfterPrice`). (4) A free word that goes on to name its own item ("No Charge
// on First Visa Debit Card.") never prices the line above (`freeWordOnItem`, the family experts' twin of
// table v13's `freeItemList`). (5) "Cashier's (Counter) Check" files by its own label as the cashier's check,
// so the section heading "Money Orders/ Cashier's Checks" is never copied into its name. The shared check is
// unchanged. The stale-read floor stays at v97.
// v174 (#1092, state key 5608, Nov 2; v164-v172 are on main, #2967 ships as v175): a monthly maintenance read, $0 or priced, whose row sits under a
// heading that names a service rather than an account is held as a range for review, never sent to
// Darwin as the account's fee (`serviceMaintenanceOf` in `@/lib/service-maintenance-heading`, flag
// `knox_service_maintenance:<services>`): River City's "Consumer Online Banking Services and Mobile
// Banking Fees" over "Monthly Maintenance Fee | No charge" is the online banking service's fee, not free
// checking. An account heading, an account's list of features and a heading in doubt are refused, not
// matched. Darwin's verify refuses it and its live re-check reads what is already live. Reads are
// unchanged; the shared check is unchanged. The stale-read floor stays at v97.
// v175 (Knox re-read backlog dry run 6, Nov 3; renumbered from v173 when merging after #2953; one wrong and five doubtful reads of 40 stored texts). (1) A
// bullet list's heading shared with the other column's priced row still heads its bullets (`listHeadingOf`),
// and an item bulleted under a stop payment heading is the stop payment's price (`stopPaymentListRead`):
// Navigant FCU's "• Bill Payment | $30.00" was filed bill pay. (2) A card replacement printed under a credit
// card title in its own column is the credit card's, left out of the read (`creditCardSectionRead`): Greylock
// FCU's free one would have published as a $0 card replacement. (3) A labelled clause's price takes its
// audience, misspelt "accoutns" included (`feeApplicability`): LM FCU's business-only $4.95 bill pay. (4) The
// same free cell in a second column, cut shorter, is held once (`sameFreeCellName`, rules.ts): Truist. Review of
// v172: a bare "Service Charge" after a price never names it (`GENERIC_FEE_NAME`, families.ts),
// `LOW_BALANCE_CHARGE` leaves "Monthly Service Charge or Minimum Balance Fee" to monthly maintenance, and
// `ITEM_INSUFFICIENT` skips deposited, cashed and paid items. The shared check is unchanged. The stale-read
// floor stays at v97.
// v177 (#1092, class R1; v176 is open PR #2969, so this takes the next free number): a priced row whose own
// name files nowhere, under a real HTML heading or table header that names one fee type, is read as that
// type's fee (`withHeadingCategoryReads`, heading-category-rows.ts). The heading comes only from the
// trailer Rosetta writes with `HTML_HEADING_CONTEXT_LIVE` on (heading-context-trailer.ts); a text without
// one reads exactly as v175, so while the switch is off no stored text reads differently. Admit-only:
// main's reads of the text are kept whole and in order. The shared check strips the trailer and is
// otherwise unchanged. The stale-read floor stays at v97.
export const KNOX_RULES_STRATEGY = { strategy: "extract.rules", version: 177 } as const;

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
  /** #2070: discontinued account rows flagged before the read (`flagDiscontinuedTables`), and how many were left out. */
  discontinuedRows: DiscontinuedTableFlag;
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
function selfCheck(
  text: string,
  feeName: string,
  amount: number,
  canonicalHint?: string,
  dailyCapLines?: boolean,
): { traces: boolean; row: string | null; reward: boolean } {
  // v136 (#2067): the row is read even when it makes the amount a rate's bound, so the read is held as
  // the percentage below rather than lost as untraced, whatever `SOURCE_CHECK_RATE_BOUND` says.
  // v137 (#2137): a row that states the amount as a reward paid to the customer never traces a read,
  // whatever `SOURCE_CHECK_REWARD_CREDIT` says, so a read traces only to a row that prices it.
  const result = checkFeeAgainstSource(text, feeName, amount, ".", canonicalHint, {
    rateBounds: false,
    rewardCredits: true,
    // v146 (#2064): the wider daily cap trace; defaults to `DAILY_CAP_LINES_LIVE`, on since 2026-11-02.
    ...(dailyCapLines == null ? {} : { dailyCapLines }),
  });
  return { traces: result.ok || result.reason === "tiered_fee", row: result.ok ? result.sourceLine : null, reward: !result.ok && result.reason === "reward_credit" };
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

/** The stored line a read's excerpt came from (whitespace folded), or the excerpt itself. */
function ownLineOf(checkText: string, excerpt: string): string {
  const fold = (value: string) => value.replace(/\s+/g, " ").trim();
  const want = fold(excerpt);
  if (!want) return excerpt;
  return checkText.split("\n").map(fold).find((line) => line.includes(want)) ?? want;
}

/**
 * v135 (#1912): a wire read whose channel is printed right after its price on its own line
 * ("Outgoing Domestic Wire Transfer $30.00 - phone request", "| $15.00 Recurring / $25.00 New") is
 * named with that channel (`wire-channel-clause.ts`). The new name must trace on the stored text, or
 * the read keeps the name it had.
 */
function withWireChannelReads(checkText: string, reads: ExtractedFeeCandidate[]): ExtractedFeeCandidate[] {
  return reads.map((read) => {
    if (!read.canonicalHint?.startsWith("wire_")) return read;
    const line = ownLineOf(checkText, read.excerpt);
    const named = withWireChannelClause(line, read.feeName, read.amount, read.canonicalHint);
    return named !== read.feeName && tracesToSource(checkText, named, read.amount) ? { ...read, feeName: named } : read;
  });
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

interface FreeSpecialistOptions {
  institutionName?: string | null;
  /** v133 (#2040): defaults to the switch, on since v155. */ noChargeSentences?: boolean;
  /** #2070: leave discontinued account rows out before any specialist reads; defaults to `KNOX_DISCONTINUED_TABLES_LIVE`, off. */
  withoutDiscontinuedTables?: boolean;
  /** v146 (#2064): the self-check's wider daily cap trace; defaults to `DAILY_CAP_LINES_LIVE`, on since 2026-11-02. */
  dailyCapLines?: boolean;
  /** v148 (#1092): a dash list run may replace base's reads of its own lines; defaults to `DASH_LIST_ROWS_LIVE`, on since 2026-11-02. */
  dashListRows?: boolean;
}

export function runFreeSpecialists(storedText: string, options: FreeSpecialistOptions = {}): FreeExtractionResult {
  // v177 (#1092): an HTML text Rosetta read with `HTML_HEADING_CONTEXT_LIVE` on ends with a trailer
  // naming the heading each line sits under (`heading-context-trailer.ts`). Every reader below reads
  // the text without it, so main's read is unchanged; then rows whose own name files nowhere are read
  // under their structural heading (`withHeadingCategoryReads`, admit-only). No trailer: main's read.
  const { text, lines } = splitHeadingContext(storedText);
  const base = readStoredText(text, options);
  if (!lines || lines.size === 0) return base;
  return withHeadingCategoryReads(base, text, lines, { read: (composed) => readStoredText(composed, options) });
}

function readStoredText(storedText: string, options: FreeSpecialistOptions): FreeExtractionResult {
  // #2070: a discontinued account's table is flagged before any specialist reads the text
  // (`flagDiscontinuedTables`); with the switch on its rows are left out, so none is read or held.
  const discontinued = flagDiscontinuedTables(storedText, options.withoutDiscontinuedTables ?? discontinuedTablesLive());
  // v148 (#1092): a price-first list that puts a dash between each price and its name ("$25.00 - NSF
  // Check/ACH/ATM item") is read by every reader and review below as the label rows it lists ("NSF
  // Check/ACH/ATM item | $25.00"), so each read is base's read of that row, and only where those reads
  // trace to the stored text and lose no other read (`readDashListsAsRows`). With `DASH_LIST_ROWS_LIVE` off
  // (it is on since 2026-11-02) a run is read as rows only where that only adds reads: every read base makes from its
  // lines is kept unchanged.
  return readDashListsAsRows(discontinued.text, (sourceText) => readFreeText(sourceText, discontinued.flag, options), {
    full: options.dashListRows,
  });
}

/**
 * v168: each plain returned check or item read as NSF moves to deposited_item_return when another read of
 * the same text names the NSF or insufficient-funds fee at a higher price (`plainReturnBesideNsf`) and that
 * type accepts the name and price. Not when an NSF read prints the return's own price ("Non-Sufficient
 * Funds | $25.00" beside "Return Check Fee | $25.00": one fee under two names), and not when the page
 * prints its own deposited item return ("NSF Deposit Fee | $30.00", "Deposited Item Return Fee"): then
 * the plain return is the member's item. An NSF-named read filed as the deposited item return is no NSF
 * price. Every other read is returned as it is.
 */
export function withReturnBesideNsf<T extends { feeName: string; amount: number | null; canonicalHint: string | null }>(
  candidates: readonly T[],
  held: ReadonlyArray<{ feeName: string; amount: number | null; canonicalHint?: string | null }> = [],
): T[] {
  const nsfPrices = [...candidates, ...held]
    .filter((row) => row.amount != null && row.canonicalHint !== "deposited_item_return" && SCHEDULE_NSF_NAME.test(row.feeName))
    .map((row) => row.amount as number);
  if (nsfPrices.length === 0) return [...candidates];
  const documentNsf = Math.max(...nsfPrices);
  return candidates.map((read) => {
    if (read.canonicalHint !== "nsf" || read.amount == null || !plainReturnBesideNsf(read.feeName, read.amount, documentNsf)) return read;
    if (nsfPrices.some((price) => Math.abs(price - (read.amount as number)) < 0.005)) return read;
    if ([...candidates, ...held].some((row) => row !== read && row.canonicalHint === "deposited_item_return")) return read;
    return checkFeeCategory("deposited_item_return", read.feeName).ok && passesDarwinChecks("deposited_item_return", read.feeName, read.amount)
      ? ({ ...read, canonicalHint: "deposited_item_return" } as T)
      : read;
  });
}

function readFreeText(sourceText: string, discontinuedRows: DiscontinuedTableFlag, options: FreeSpecialistOptions): FreeExtractionResult {
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
  // v170 (backlog dry run 3): a heading cell the page repeats in each row's cells ("Returned Check (Service /
  // Item) | $10 (Fee)") is no part of the fee's name or price (`withoutColumnLabelEchoes`).
  const checkText = withSidewaysBoxTable(withBoxSizeCellsSplit(withoutBusinessOnlyFees(joinLabeledFeeCardText(withGluedFootnotePrices(withoutCardProgramSections(withoutGluedPricePairs(withoutColumnLabelEchoes(sourceText))))))));
  // v115 (#1905): an ATM network table's rows are read only by their non-network column
  // (`withNetworkColumnFees`); no other reader sees them, so none takes another column's price.
  const text = withoutNetworkTableRows(withTierColumnRows(checkText));
  // v168 (second re-read backlog dry run, Nov 2): a box table's late-fee column is no rent (`boxLateColumnRead`).
  const boxLatePrices = boxLateColumnPrices(checkText);
  // v175 (backlog dry run 6): a card replacement under a credit card title in its own column is the credit card's.
  const creditCardColumns = creditCardSectionColumns(checkText);
  // v138 (#2285): a declined wire line's direction prices are the rules pass's held rows, each named
  // by its own clause; no price window reads the line, so none takes the clause before it.
  const heldWireLines = new Set(heldWireClausePrices(text).map((row) => row.sourceLine));
  const legacyText = withoutFeeBullets(text, recognizedFeeBullets(text))
    .split("\n").map((line) => (heldWireLines.has(line.trim()) ? "" : line)).join("\n");
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

  // Admits one specialist's held row under the per-document caps; "untraced" when its $0 failed the self-check.
  const admitHeld = (heldRow: HeldFeeCandidate): "kept" | "untraced" | "skipped" => {
    // v76: $0 and "prices vary" holds take their own half of the cap, so a schedule's free rows
    // never push out a priced hold (or the other way round).
    const unpricedHold = unpricedHalf(heldRow);
    if (held.filter((row) => unpricedHalf(row) === unpricedHold).length >= MAX_HELD_PER_DOCUMENT) {
      if (heldRow.shape === "unclassified") countDropped("unclassified_cap");
      return "skipped";
    }
    const foundRow = { ...heldRow, feeName: tidyUnmarkedName(heldRow.feeName, text, institutionName, heldRow.canonicalHint) };
    if (foundRow.shape === "zero" && readsAMeasuredAmount(text, foundRow.feeName, 0)) return "skipped";
    // v151 (#2137): a held read at a reward paid to the customer ("plus $500 toward mortgage appraisal
    // fees", inst 640) is no fee either; a held row can be filed later (v101), so it is dropped like a
    // candidate. A row that prices the fee gives its own read.
    if (foundRow.amount !== null && foundRow.amount > 0 && rewardCreditOf(foundRow.excerpt, foundRow.amount, foundRow.feeName)) return "skipped";
    // A $0 row can go live through the rules re-check, so it passes the same self-check.
    const untracedZero = foundRow.shape === "zero" && !tracesToSource(checkText, foundRow.feeName, 0);
    const row: HeldFeeCandidate = untracedZero ? { ...foundRow, shape: "untraced" } : foundRow;
    const key = heldKey(row);
    if (seenHeld.has(key)) return "skipped";
    if (row.shape === "unclassified" && unclassified >= MAX_UNCLASSIFIED_PER_DOCUMENT) {
      countDropped("unclassified_cap");
      return "skipped";
    }
    seenHeld.add(key);
    if (row.shape === "unclassified") unclassified += 1;
    held.push(row);
    return untracedZero ? "untraced" : "kept";
  };
  const deferredTableHolds: HeldFeeCandidate[] = [];

  for (const specialist of specialists) {
    const run = specialist.run();
    // v78 (#1304): no specialist files a bill payment priced under an overdraft or NSF heading on
    // its own line as bill pay (`billPayByHeading`); the table pass named such a cell by its words.
    // v111 (#1916): every specialist's late fee printed in a safe deposit box section is the box's
    // (`boxSectionLateFeeRead`), read on the self-check's text.
    // v123 (#1905): every specialist's deposit-category read printed in a loan section is the loan's
    // (`loanSectionFeeRead`), read on the same text.
    // v135 (#1912): a wire price whose channel is printed after it on its own line keeps that channel
    // in its name (`withWireChannelReads`), so statistics rule 11 can tell it from the general price.
    // v164 (live-source audit, Nov 2): a bullet item in a later cell is named by its own cell, never by the
    // other column's cells before it (`bulletItemRead`; 54298 at 6230). A rename only: no line moves.
    // v175 (backlog dry run 6): an item bulleted under a stop payment heading is that stop payment's price
    // (`stopPaymentListRead`: "Stop Payment" over "• Bill Payment | $30.00", Navigant FCU doc 2007).
    // v175: no specialist files a card replacement printed under a credit card title in its own column as the
    // debit card's (`creditCardSectionRead`: "CREDIT CARD CHARGES" over "Card Replacement ...... Free", Greylock FCU).
    // v168: no specialist reads a box table's late-fee column as the box's rent (`boxLateColumnRead`:
    // "BOX SIZE | ANNUALLY | LATE FEE" over "3” x 10” x 24” | $35.00 | $6.00", Eglin FCU 5451).
    const found = { ...run, candidates: withWireChannelReads(checkText, run.candidates.map((read) => { const next = billPayByHeading(read); return next && carryColumnHeadingCell(read, next); }).filter((read): read is ExtractedFeeCandidate => read != null).map((read) => stopPaymentListRead(bulletItemRead(payeeReturnedBillPayRead(loanSectionFeeRead(boxSectionLateFeeRead(read, checkText), checkText), checkText)), checkText))
      .filter((read) => !boxLateColumnRead(read, boxLatePrices) && !creditCardSectionRead(read, checkText, creditCardColumns))),
      held: run.held.filter((read) => !creditCardSectionRead(read, checkText, creditCardColumns)) };
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
      const checked = selfCheck(checkText, feeName, read.amount, read.canonicalHint, options.dailyCapLines);
      // v147 (review of 35d5ba2): a price after a free allowance is settled exactly as base settles the same
      // fee with no allowance, on its row rebuilt that way (`allowanceRow`, `allowanceBaseRow` in rules.ts).
      // Base's own-unit pass (`withOwnFeeUnit`, run on every read at the end) reads the same rebuilt row here,
      // so a unit like "hourly", "per hr", "each hour" or "per 1/2 hour" settles exactly as with no allowance.
      // Only its frequency is kept: the rebuilt row is not a stored line, so it is never stored as evidence.
      const settleRow = read.allowanceRow ?? checked.row;
      const rowFrequency = settleRow ? frequencyFromLine(settleRow, read.amount) : null;
      const allowanceUnit = read.allowanceRow ? ownFeeUnit(read.allowanceRow, feeName, read.amount, read.canonicalHint) : null;
      // Review of 34a44e3: another price shares the cell and no period word is between them: per item.
      // Review of 34a44e3: on the rebuilt row (only the name, the price and its own unit) an hourly price is
      // read as Darwin's verify reads it (`hourly: true`), so a long name that `ownFeeUnit` cannot place keeps
      // its "per hour"; on a stored row Darwin's own hourly reading is blocked by the allowance's "per month".
      const hourly = read.allowanceRow ? { hourly: true } : {};
      const frequency = read.allowancePerItem ? "per_item" : allowanceUnit?.frequency ?? (rowFrequency
        ? settledFrequency(settleRow, read.amount, rowFrequency, read.canonicalHint, hourly)
        : settledFrequency(read.allowanceRow ?? read.excerpt, read.amount, read.frequency, read.canonicalHint, hourly));
      // v147 (re-review of 70d2d09): admit-only backstop. The read is kept only when Darwin's verified
      // frequency agrees, on the excerpt Knox stores (`storedOwnExcerpt`, the string extract.ts writes and
      // Darwin reads back) and on the whole excerpt the lab's Darwin reads; otherwise Darwin would publish
      // the next fee's period ("then $2.00, Annual Fee $10.00" as annual), so it is left out, as before v147.
      if (read.allowancePrice && [storedOwnExcerpt({ ...read, feeName }), read.excerpt]
        .some((excerpt) => verifiedFrequency(excerpt, read.amount, frequency, read.canonicalHint) !== frequency)) {
        countDropped("allowance_frequency_disagrees");
        continue;
      }
      const candidate = { ...read, ...feeApplicability(feeName, read.excerpt, read.amount), feeName, frequency };
      // v28: a limit is not a price ("Zelle transfer limit | $1,000").
      if (namesALimit(candidate.feeName, candidate.canonicalHint)) continue;
      // v115 (#1905): a late charge's cap or floor ("maximum late charge of $30 in WV", "Minimum Late
      // Fee $10" beside "5% of Payment Amount") bounds a percentage charge; it is no late fee.
      if (namesLateChargeBound(candidate.feeName)) continue;
      // v137 (#2137): a reward, bonus or credit paid to the customer ("Earn $50 when you complete two or
      // more online bill payments", "$5 reward") is no price. The read is dropped when the only row the
      // self-check finds states the figure as one, or when its own line does and no row prices it.
      if (checked.reward || (rewardCreditOf(candidate.excerpt, candidate.amount, candidate.feeName) && !checked.traces)) continue;
      // v118 (#1615): a price its own line makes the floor of a percentage charge ("$5.00 or 3% of
      // each cash advance, whichever is greater", "Greater of 10% of Item or $10") is the least the
      // charge can be, not its price. It is held as the percentage, so the rate pass below files the
      // rate fee with this floor as its rate_min_amount (or keeps it held), never a flat fee.
      // v136 (#2067): so is a price its own line makes the minimum or maximum of a percentage charge
      // ("4% of advance (min. of $5)", "Non-Member ($10 Max) | 5% of Total"); the rate pass files it as
      // the rate fee's rate_min_amount or rate_max_amount (`rateBoundOf`, shared with the source check).
      const floorLine = [candidate.excerpt, checked.row]
        .find((line): line is string => !!line && rateFloorOf(line, candidate.amount, candidate.feeName) !== null);
      const boundLine = floorLine ? null : [candidate.excerpt, checked.row]
        .find((line): line is string => !!line && rateBoundOf(line, candidate.amount, candidate.feeName) !== null);
      const floor = floorLine
        ? rateFloorOf(floorLine, candidate.amount, candidate.feeName)
        : boundLine ? rateBoundOf(boundLine, candidate.amount, candidate.feeName) : null;
      const rateLine = floorLine ?? boundLine;
      if (rateLine && floor) {
        const row: HeldFeeCandidate = {
          shape: "percentage",
          feeName: candidate.feeName,
          amount: null,
          amountMax: null,
          percent: floor.ratePercent,
          frequency: candidate.frequency,
          canonicalHint: candidate.canonicalHint,
          excerpt: rateLine,
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
      // v170 (backlog dry run 3, Peninsula Community FCU doc 41842): the balance a rate disclosure says earns
      // no dividend ("If your average daily balance is below $100.00 ($5.00 for accounts held by those
      // under 18 years of age), no dividends are earned") is no fee (`dividendThresholdSentence`).
      if (dividendThresholdSentence(candidate.excerpt, candidate.amount)) {
        countDropped("dividend_threshold");
        continue;
      }
      // v169 (#1092, Mountain Star FCU text 36365): a name the page lists as free ("Other Free Services:
      // ... Check Writing, Balance Inquiries," / "Money market | Fax Service" / "$5.00") never takes a price the self-check found on another line (`freeListItemRead`, on
      // the line the shared check traced). The read is held untraced, as one that does not trace.
      const freeItem = checked.traces && freeListItemRead({ feeName: candidate.feeName, amount: candidate.amount, tracedLine: checked.row, documentText: checkText });
      if (freeItem) countDropped("free_list_item");
      if (!checked.traces || freeItem) {
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
      // v167: the table pass's rows no rule names wait until every specialist has read, so they never
      // take the unclassified cap from another reader's hold.
      if (specialist.strategy === KNOX_TABLE_STRATEGY.strategy && heldRow.shape === "unclassified" && heldRow.canonicalHint == null) {
        deferredTableHolds.push(heldRow);
        continue;
      }
      if (admitHeld(heldRow) === "untraced") selfCheckFailed += 1;
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

  for (const heldRow of deferredTableHolds) admitHeld(heldRow);

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

  // v168 (second re-read backlog dry run, Nov 2): a plain "Returned check charge" read as NSF, on a schedule
  // whose own NSF or insufficient-funds read is a separate, higher price, is the returned deposited item
  // fee, by the guard's own schedule rule (`plainReturnBesideNsf`, v22/v23): First Financial Bank (624,
  // doc 41794) prints "Returned check charge | $7.00" beside "Returned NSF/OD Fee (Insufficient
  // Funds/Overdraft Fee, per item) | $32.00". Hamilton's live guard reads the same rule from the
  // document's Knox rows; Knox reads it from this text's reads, so the row is filed right before Darwin.
  // An NSF read at the return's own price, or the page's own deposited item return, keeps it NSF (the
  // seven-state key 5918: "Return Check Fee | $25.00" beside "Non-Sufficient Funds | $25.00").
  candidates.splice(0, candidates.length, ...withReturnBesideNsf(candidates, held));

  // v150: a bare "Overdraft Protection" line is the paid-overdraft item fee when the schedule prints its
  // own overdraft transfer line and no other read is the overdraft fee (Alcose CU 51252, "Overdraft
  // Transfers $2.00" over "Overdraft Protection $30.00 per item"); a per-transfer, per-use or periodic
  // unit keeps it the transfer (`withProtectionItemReads`). The line's words decide, never the price.
  candidates.splice(0, candidates.length, ...withProtectionItemReads(checkText, candidates, held));

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
  // prints. Behind NO_CHARGE_SENTENCE_READ_LIVE (on since v155).
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
  // v170 (backlog dry run 3, Cinfed FCU doc 41914): a monthly service fee in a section of online,
  // electronic or digital services ("Online Fees" / ... / "Cinfed Connection Monthly Service Fee | FREE") is
  // that service's charge, not the account's monthly maintenance (`onlineServiceMonthlyFee`); no type of the
  // 50 holds it, so it is not read, as "Online Banking Monthly Service Fee | FREE" beside it is not.
  const onlineService = (row: { canonicalHint?: string | null; feeName: string; excerpt?: string | null }) =>
    row.canonicalHint === "monthly_maintenance" && onlineServiceMonthlyFee(row.feeName, row.excerpt, checkText) !== null;
  for (let at = candidates.length - 1; at >= 0; at--) {
    if (!onlineService(candidates[at])) continue;
    candidates.splice(at, 1);
    countDropped("online_service_monthly");
  }
  for (let at = stillHeld.length - 1; at >= 0; at--) {
    if (!onlineService(stillHeld[at])) continue;
    stillHeld.splice(at, 1);
    countDropped("online_service_monthly");
  }
  // v170 (backlog dry run 3, Morton Community Bank doc 40112): a read's name keeps the dollar threshold its
  // own line ties to it ("Cashier's Check more than $1,000 (MCB customers only)"), a rename only, so the
  // name is the page's words and the shared check finds the row (`withThresholdFigures`).
  for (let at = 0; at < candidates.length; at++) {
    const read = candidates[at];
    const renamed = withThresholdFigures(read.feeName, read.excerpt, read.amount);
    if (renamed !== read.feeName && passesDarwinChecks(read.canonicalHint, renamed, read.amount)) candidates[at] = { ...read, feeName: renamed };
  }
  const unitHolds = stillHeld.map(row => row.shape === "zero" && row.canonicalHint && row.amount != null
    ? withOwnFeeUnit({ ...row, amount: row.amount, canonicalHint: row.canonicalHint }, sourceText) : row);
  // v147: an allowance read's unit was settled on its rebuilt row above, and checked against Darwin's.
  return { candidates: candidates.map(candidate => (candidate.allowancePrice ? candidate : withOwnFeeUnit(candidate, sourceText))), held: unitHolds, rates, runs, dropped, discontinuedRows };
}
