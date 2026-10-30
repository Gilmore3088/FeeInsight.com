import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { takedownCheck, TAKEDOWN_REASON_CHECKS } from "./feedback";
import { MISFILED_TAKEDOWN_CHECKS } from "./feedback-sync";

import { BANDED_ZERO_CHECK, BANDED_ZERO_REASON } from "@/lib/agents/darwin/banded-zero-check";
import { CANADIAN_DOCUMENT_CHECK, CANADIAN_DOCUMENT_REASON } from "@/lib/agents/darwin/canadian-document-check";
import { CARD_PROGRAM_SECTION_CHECK, CARD_PROGRAM_SECTION_REASON } from "@/lib/agents/darwin/card-program-section-check";
import { DOCUMENT_OWNER_CHECK, DOCUMENT_OWNER_REASON } from "@/lib/agents/darwin/document-owner";
import { INTERNATIONAL_DIRECTION_CHECK, INTERNATIONAL_DIRECTION_REASON } from "@/lib/agents/darwin/international-direction-check";
import { LATE_CHARGE_BOUND_CHECK, LATE_CHARGE_BOUND_REASON } from "@/lib/agents/darwin/late-charge-bound-check";
import { LINE_CONFLICT_CHECK, LINE_CONFLICT_REASON_PREFIX } from "@/lib/agents/darwin/line-conflict-check";
import { LOAN_SECTION_CHECK, LOAN_SECTION_REASON } from "@/lib/agents/darwin/loan-section-check";
import {
  BROKERAGE_DOCUMENT_REASON, CARD_PROGRAM_DOCUMENT_REASON, CREDIT_TERMS_DOCUMENT_REASON, LENDING_WORDING_REASON,
  LOAN_TITLED_DOCUMENT_REASON, NON_DEPOSIT_CHECK, NON_DEPOSIT_REASON, YOUTH_ACCOUNT_DOCUMENT_REASON,
} from "@/lib/agents/darwin/non-deposit-document-check";
import { PRODUCT_PAGE_REPEAT_CHECK, PRODUCT_PAGE_REPEAT_REASON } from "@/lib/agents/darwin/product-page-repeat-check";
import { NO_FEE_SENTENCE_CHECK, NO_FEE_SENTENCE_REASON } from "@/lib/agents/darwin/no-fee-sentence-check";
import { RATE_FLOOR_CHECK, RATE_FLOOR_REASON } from "@/lib/agents/darwin/rate-floor-check";
import { RELEASE_REPAIR_CHECK, RELEASE_REPAIR_REASON_PREFIX } from "@/lib/agents/darwin/release-repair";
import { REREAD_CATEGORY_CHECK, REREAD_CATEGORY_TWIN_REASON } from "@/lib/agents/darwin/reread-category-check";
import { SAME_LINE_READ_CHECK } from "@/lib/agents/darwin/same-line-read-check";
import { SAME_LINE_REPLACEMENT_CHECK } from "@/lib/agents/darwin/same-line-replacement-check";
import { TRANSLATED_COPY_CHECK, TRANSLATED_COPY_REASON } from "@/lib/agents/darwin/translated-copy-check";
import { DARWIN_RECHECK_CHECK, RECHECK_REJECTED_FLAG_PREFIX } from "@/lib/agents/darwin/verified-recheck";
import { ARTICLE_PAGE_CHECK, ARTICLE_PAGE_REASON } from "@/lib/agents/hamilton/article-page";
import { BUSINESS_SCHEDULE_CHECK, BUSINESS_SCHEDULE_REASON } from "@/lib/agents/hamilton/business-schedule";
import { CATEGORY_GUARD_CHECK } from "@/lib/agents/hamilton/category-guard";
import { CROSS_PAGE_CHECK, CROSS_PAGE_REASON } from "@/lib/agents/hamilton/cross-page-conflict";
import { CURRENT_COPY_CHECK, CURRENT_COPY_REASON } from "@/lib/agents/hamilton/current-copy";
import { EVAL_VERDICT_CHECK } from "@/lib/agents/hamilton/eval-verdicts";
import { LIMIT_GUARD_CHECK, LIMIT_GUARD_REASON } from "@/lib/agents/hamilton/limit-guard";
import { OTHER_BANK_DOCUMENT_CHECK, OTHER_BANK_DOCUMENT_REASON, UNCONFIRMED_HOST_CHECK, UNCONFIRMED_HOST_REASON } from "@/lib/agents/hamilton/other-bank-document";
import { PRODUCT_PAGE_CONFLICT_CHECK, PRODUCT_PAGE_CONFLICT_REASON } from "@/lib/agents/hamilton/product-page-conflict";
import { PRODUCT_PAGE_CHECK, PRODUCT_PAGE_REASON } from "@/lib/agents/hamilton/product-page";
import { RESTORE_RECHECK_CHECK, RESTORE_RECHECK_REASON } from "@/lib/agents/hamilton/restore-recheck";
import { RULES_RECHECK_CHECK, RULES_RECHECK_REASON } from "@/lib/agents/hamilton/rules-recheck";
import { SAME_LINE_DUPLICATE_CHECK, SAME_LINE_DUPLICATE_REASON } from "@/lib/agents/hamilton/same-line-duplicates";
import { SOURCE_CHECK_REASON, SOURCE_CHECK_STRATEGY } from "@/lib/agents/hamilton/source-check";
import { SOURCE_LINK_CHECK, SOURCE_LINK_DRIFT_CHECK, SOURCE_LINK_DRIFT_REASON, SOURCE_LINK_TAKEDOWN_REASON } from "@/lib/agents/hamilton/source-link";
import { TAXONOMY_FOLD_CHECK, TAXONOMY_FOLD_REASON_PREFIX } from "@/lib/agents/hamilton/taxonomy-fold";
import { EDITION_CHECK, NOT_YET_EFFECTIVE_REASON, OLDER_EDITION_REASON } from "@/lib/agents/darwin/edition-effective-check";
import { LIVE_FRAGMENT_CHECK, LIVE_FRAGMENT_REASON_PREFIX } from "@/lib/agents/darwin/live-fragment-check";
import { ACCOUNT_TYPE_HOLD_CHECK, ACCOUNT_TYPE_HOLD_REASON } from "@/lib/agents/hamilton/account-type-hold";
import { CLOSED_INSTITUTION_REASON } from "@/lib/agents/hamilton/closed-institution";
import { COMPANION_RETIRE_REASON } from "@/lib/agents/hamilton/companion-retire";
import { CUT_NAME_DUPLICATE_CHECK, CUT_NAME_DUPLICATE_REASON } from "@/lib/agents/hamilton/cut-name-duplicates";
import { DUPLICATE_COLLAPSE_REASON_PREFIX } from "@/lib/agents/hamilton/duplicate-collapse";
import { FREQUENCY_FILL_CHECK, FREQUENCY_HOLD_REASON } from "@/lib/agents/hamilton/frequency-fill";
import { HAND_TAKEDOWN_CHECK } from "@/lib/agents/hamilton/hand-takedowns";
import { NEWER_COPY_RETIRE_REASON } from "@/lib/agents/hamilton/newer-copy-retire";
import { OFF_TAXONOMY_ROLLBACK_REASON } from "@/lib/agents/hamilton/off-taxonomy-rollback";
import { OUTLIER_ROLLBACK_REASON } from "@/lib/agents/hamilton/outlier-rollback";
import { ADMIN_CORRECTION_PREFIX } from "@/lib/fee-correction-rules";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

/** A reason as the producer writes it: `<prefix>: <detail>`, or the producer's own prefix with its detail glued on. */
const said = (prefix: string) => (/[:#]\s*$/.test(prefix) ? `${prefix}12 (detail)` : `${prefix}: detail`);

/**
 * Every module that takes live fees down: through a second look (`secondLook(`), or by archiving
 * `published_fee_records` with a reason. Each row is the check it files under and every takedown reason
 * it writes. `keeps` marks a reason that cannot name its check and keeps the sync's name: a prefix more
 * than one check writes, a module with no check of its own (`check: null`), or a name a reader matches.
 */
type Producer = { check: string | null; reasons: string[]; keeps?: string };
const DUPLICATE = "hamilton.duplicate_collapse";
const PRODUCERS: Record<string, Producer[]> = {
  "agents/darwin/banded-zero-check.ts": [{ check: BANDED_ZERO_CHECK, reasons: [BANDED_ZERO_REASON] }],
  "agents/darwin/canadian-document-check.ts": [{ check: CANADIAN_DOCUMENT_CHECK, reasons: [CANADIAN_DOCUMENT_REASON] }],
  "agents/darwin/card-program-section-check.ts": [{ check: CARD_PROGRAM_SECTION_CHECK, reasons: [CARD_PROGRAM_SECTION_REASON] }],
  "agents/darwin/document-owner.ts": [{ check: DOCUMENT_OWNER_CHECK, reasons: [DOCUMENT_OWNER_REASON] }],
  "agents/darwin/edition-effective-check.ts": [{ check: EDITION_CHECK, reasons: [OLDER_EDITION_REASON, NOT_YET_EFFECTIVE_REASON] }],
  "agents/darwin/international-direction-check.ts": [{ check: INTERNATIONAL_DIRECTION_CHECK, reasons: [INTERNATIONAL_DIRECTION_REASON] }],
  "agents/darwin/late-charge-bound-check.ts": [{ check: LATE_CHARGE_BOUND_CHECK, reasons: [LATE_CHARGE_BOUND_REASON] }],
  "agents/darwin/line-conflict-check.ts": [{ check: LINE_CONFLICT_CHECK, reasons: [LINE_CONFLICT_REASON_PREFIX] }],
  "agents/darwin/live-fragment-check.ts": [{ check: LIVE_FRAGMENT_CHECK, reasons: [LIVE_FRAGMENT_REASON_PREFIX] }],
  "agents/darwin/loan-section-check.ts": [{ check: LOAN_SECTION_CHECK, reasons: [LOAN_SECTION_REASON] }],
  "agents/darwin/non-deposit-document-check.ts": [{ check: NON_DEPOSIT_CHECK, reasons: [NON_DEPOSIT_REASON, LENDING_WORDING_REASON, BROKERAGE_DOCUMENT_REASON,
    CARD_PROGRAM_DOCUMENT_REASON, LOAN_TITLED_DOCUMENT_REASON, YOUTH_ACCOUNT_DOCUMENT_REASON, CREDIT_TERMS_DOCUMENT_REASON] }],
  "agents/darwin/product-page-repeat-check.ts": [{ check: PRODUCT_PAGE_REPEAT_CHECK, reasons: [PRODUCT_PAGE_REPEAT_REASON] }],
  "agents/darwin/no-fee-sentence-check.ts": [{ check: NO_FEE_SENTENCE_CHECK, reasons: [NO_FEE_SENTENCE_REASON] }],
  "agents/darwin/rate-floor-check.ts": [{ check: RATE_FLOOR_CHECK, reasons: [RATE_FLOOR_REASON] }],
  "agents/darwin/release-repair.ts": [{ check: RELEASE_REPAIR_CHECK, reasons: [RELEASE_REPAIR_REASON_PREFIX] }],
  "agents/darwin/reread-category-check.ts": [{ check: REREAD_CATEGORY_CHECK, reasons: [REREAD_CATEGORY_TWIN_REASON, REREAD_CATEGORY_CHECK] }],
  // Hamilton's same-line duplicate check writes the same prefix.
  "agents/darwin/same-line-read-check.ts": [{ check: SAME_LINE_READ_CHECK, reasons: [SAME_LINE_DUPLICATE_REASON], keeps: SAME_LINE_DUPLICATE_CHECK }],
  "agents/darwin/same-line-replacement-check.ts": [{ check: SAME_LINE_REPLACEMENT_CHECK, reasons: [SAME_LINE_DUPLICATE_REASON], keeps: SAME_LINE_DUPLICATE_CHECK }],
  "agents/darwin/translated-copy-check.ts": [{ check: TRANSLATED_COPY_CHECK, reasons: [TRANSLATED_COPY_REASON] }],
  "agents/darwin/verified-recheck.ts": [{ check: DARWIN_RECHECK_CHECK, reasons: [`${RECHECK_REJECTED_FLAG_PREFIX}:`] }],
  "agents/hamilton/account-type-hold.ts": [{ check: ACCOUNT_TYPE_HOLD_CHECK, reasons: [ACCOUNT_TYPE_HOLD_REASON] }],
  "agents/hamilton/article-page.ts": [{ check: ARTICLE_PAGE_CHECK, reasons: [ARTICLE_PAGE_REASON] }],
  "agents/hamilton/business-schedule.ts": [{ check: BUSINESS_SCHEDULE_CHECK, reasons: [BUSINESS_SCHEDULE_REASON] }],
  "agents/hamilton/category-guard.ts": [{ check: CATEGORY_GUARD_CHECK, reasons: ["category_guard:"] }],
  // No check constant of its own: the sync's name is the only one it has.
  "agents/hamilton/closed-institution.ts": [{ check: null, reasons: [CLOSED_INSTITUTION_REASON], keeps: `hamilton.${CLOSED_INSTITUTION_REASON}` }],
  "agents/hamilton/companion-retire.ts": [{ check: null, reasons: [COMPANION_RETIRE_REASON], keeps: `hamilton.${COMPANION_RETIRE_REASON}` }],
  "agents/hamilton/cross-page-conflict.ts": [{ check: CROSS_PAGE_CHECK, reasons: [CROSS_PAGE_REASON] }],
  "agents/hamilton/current-copy.ts": [{ check: CURRENT_COPY_CHECK, reasons: [`${CURRENT_COPY_REASON}:#`] }],
  "agents/hamilton/cut-name-duplicates.ts": [{ check: CUT_NAME_DUPLICATE_CHECK, reasons: [CUT_NAME_DUPLICATE_REASON] }],
  "agents/hamilton/duplicate-collapse.ts": [{ check: null, reasons: [DUPLICATE_COLLAPSE_REASON_PREFIX], keeps: DUPLICATE }],
  // Eval verdicts name each takedown after its verdict kind ("wrong_amount:", "not_a_fee:"), words other
  // producers also write, and the registry's readers match the sync's names for those kinds.
  "agents/hamilton/eval-verdicts.ts": [
    { check: EVAL_VERDICT_CHECK, reasons: ["eval_critical"], keeps: "hamilton.eval_critical" },
    { check: EVAL_VERDICT_CHECK, reasons: ["not_a_fee"], keeps: "hamilton.not_a_fee" },
    { check: EVAL_VERDICT_CHECK, reasons: ["wrong_amount"], keeps: "hamilton.wrong_amount" },
    { check: EVAL_VERDICT_CHECK, reasons: ["wrong_category"], keeps: "hamilton.wrong_category" },
  ],
  "agents/hamilton/frequency-fill.ts": [{ check: FREQUENCY_FILL_CHECK, reasons: [FREQUENCY_HOLD_REASON] }],
  // A person's takedown: a source mismatch is the hand check's own; a repeat shares the collapse's prefix.
  "agents/hamilton/hand-takedowns.ts": [
    { check: HAND_TAKEDOWN_CHECK, reasons: ["source_mismatch: #"] },
    { check: HAND_TAKEDOWN_CHECK, reasons: [DUPLICATE_COLLAPSE_REASON_PREFIX], keeps: DUPLICATE },
  ],
  "agents/hamilton/limit-guard.ts": [{ check: LIMIT_GUARD_CHECK, reasons: [LIMIT_GUARD_REASON] }],
  "agents/hamilton/newer-copy-retire.ts": [{ check: null, reasons: [`${NEWER_COPY_RETIRE_REASON}:#`], keeps: `hamilton.${NEWER_COPY_RETIRE_REASON}` }],
  // Darwin's release review reads these rows by the sync's name (`feedback-kinds.ts`, off_taxonomy).
  "agents/hamilton/off-taxonomy-rollback.ts": [{ check: null, reasons: [OFF_TAXONOMY_ROLLBACK_REASON], keeps: `hamilton.${OFF_TAXONOMY_ROLLBACK_REASON}` }],
  "agents/hamilton/other-bank-document.ts": [
    { check: OTHER_BANK_DOCUMENT_CHECK, reasons: [OTHER_BANK_DOCUMENT_REASON] },
    { check: UNCONFIRMED_HOST_CHECK, reasons: [UNCONFIRMED_HOST_REASON] },
  ],
  "agents/hamilton/outlier-rollback.ts": [{ check: null, reasons: [OUTLIER_ROLLBACK_REASON], keeps: `hamilton.${OUTLIER_ROLLBACK_REASON}` }],
  "agents/hamilton/page-copy-collapse.ts": [{ check: null, reasons: [DUPLICATE_COLLAPSE_REASON_PREFIX], keeps: DUPLICATE }],
  "agents/hamilton/product-page-conflict.ts": [{ check: PRODUCT_PAGE_CONFLICT_CHECK, reasons: [PRODUCT_PAGE_CONFLICT_REASON] }],
  "agents/hamilton/product-page.ts": [{ check: PRODUCT_PAGE_CHECK, reasons: [PRODUCT_PAGE_REASON] }],
  "agents/hamilton/publish.ts": [{ check: null, reasons: ["superseded by #"], keeps: DUPLICATE }],
  "agents/hamilton/restore-recheck.ts": [{ check: RESTORE_RECHECK_CHECK, reasons: [RESTORE_RECHECK_REASON] }],
  "agents/hamilton/rules-recheck.ts": [{ check: RULES_RECHECK_CHECK, reasons: [RULES_RECHECK_REASON] }],
  "agents/hamilton/same-line-duplicates.ts": [{ check: SAME_LINE_DUPLICATE_CHECK, reasons: [SAME_LINE_DUPLICATE_REASON] }],
  "agents/hamilton/source-check.ts": [{ check: SOURCE_CHECK_STRATEGY.strategy, reasons: [SOURCE_CHECK_REASON] }],
  "agents/hamilton/source-link.ts": [
    { check: SOURCE_LINK_CHECK, reasons: [SOURCE_LINK_TAKEDOWN_REASON] },
    { check: SOURCE_LINK_DRIFT_CHECK, reasons: [SOURCE_LINK_DRIFT_REASON] },
  ],
  "agents/hamilton/taxonomy-fold.ts": [{ check: TAXONOMY_FOLD_CHECK, reasons: [TAXONOMY_FOLD_REASON_PREFIX] }],
  // A hand correction's old row: its sync copy keeps `hamilton.admin_correction`, the name Knox's
  // lessons skip it by (the person's own row, `admin.fee_correction`, is the finding).
  "fee-corrections.ts": [{ check: null, reasons: [ADMIN_CORRECTION_PREFIX], keeps: "hamilton.admin_correction" }],
};

const LIB = join(process.cwd(), "src/lib");
/** A module that takes live fees down: it runs a second look, or sets `rolled_back_at` to a time. */
const TAKES_DOWN = /\bsecondLook\(|rolled_back_at\s*=\s*(?:NOW\(\)|now\(\)|COALESCE|CURRENT_TIMESTAMP|clock_timestamp|\$\{)/;

function takedownModules(dir = LIB): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { found.push(...takedownModules(path)); continue; }
    if (!entry.name.endsWith(".ts") || entry.name.includes(".test.") || entry.name === "second-look.ts") continue;
    if (TAKES_DOWN.test(readFileSync(path, "utf8"))) found.push(relative(LIB, path));
  }
  return found.sort();
}

describe("a takedown files under the check that made it (#2062)", () => {
  it("lists every module that takes live fees down", () => {
    // A new module that runs a second look or archives a live fee goes in PRODUCERS with its check and
    // reasons, so the lines below can pin its reasons to its check.
    expect(takedownModules()).toEqual(Object.keys(PRODUCERS).sort());
  });

  for (const [file, entries] of Object.entries(PRODUCERS)) {
    for (const { check, reasons, keeps } of entries) {
      it(`${file}: its reasons name ${keeps ?? check}`, () => {
        for (const reason of reasons) expect(takedownCheck(said(reason)), reason).toBe(keeps ?? check);
      });
    }
  }

  it("maps no prefix that no producer writes, and relabels every name the sync used to give them", () => {
    const written = new Set(Object.values(PRODUCERS).flat().filter((entry) => !entry.keeps)
      .flatMap((entry) => entry.reasons.map((reason) => reason.replace(/[:#\s]+$/, "").split(":")[0].trim())));
    expect(Object.keys(TAKEDOWN_REASON_CHECKS).filter((prefix) => !written.has(prefix))).toEqual([]);
    expect(MISFILED_TAKEDOWN_CHECKS).toEqual(Object.keys(TAKEDOWN_REASON_CHECKS).map((prefix) => `hamilton.${prefix}`));
    // The 9 Darwin re-checks named in #2062, and the line conflict and verified re-check found beside them.
    for (const [reason, check] of [["rate_floor: x", RATE_FLOOR_CHECK], ["banded_zero: x", BANDED_ZERO_CHECK],
      ["card_program_section: #1", CARD_PROGRAM_SECTION_CHECK], ["translated_copy: #1 twin #2", TRANSLATED_COPY_CHECK],
      ["document_owner: names institution 3", DOCUMENT_OWNER_CHECK], ["non_deposit_document: x", NON_DEPOSIT_CHECK],
      ["card_program_document: x", NON_DEPOSIT_CHECK], ["product_page_repeat: #1 twin #2", PRODUCT_PAGE_REPEAT_CHECK],
      ["late_charge_bound: x", LATE_CHARGE_BOUND_CHECK], ["release_repair:category_not_in_text_and_disputed", RELEASE_REPAIR_CHECK],
      ["one line, two reads: kept #5 (amount, a: b)", LINE_CONFLICT_CHECK], ["darwin_recheck:name_rule:v9", DARWIN_RECHECK_CHECK],
      ["older_edition: #12 effective 2026-01-01", EDITION_CHECK], ["not_yet_effective: 2027-01-01 #12", EDITION_CHECK],
      ["fragment name: sentence_end", LIVE_FRAGMENT_CHECK], ["source_mismatch: #1496", HAND_TAKEDOWN_CHECK]] as const) {
      expect(takedownCheck(reason), reason).toBe(check);
    }
  });
});
