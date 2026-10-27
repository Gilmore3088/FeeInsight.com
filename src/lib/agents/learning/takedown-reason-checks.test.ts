import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

/** A reason as the producer writes it: `<prefix>: <detail>`, or the producer's own prefix with its detail glued on. */
const said = (prefix: string) => (/[:#]\s*$/.test(prefix) ? `${prefix}12 (detail)` : `${prefix}: detail`);

/**
 * Every module that takes live fees down through a second look (`secondLook(`), with the check its
 * second look files under and every takedown reason it writes. A reason prefix more than one check
 * writes cannot name its check, so it is listed under `shared` with the producers that share it.
 */
const PRODUCERS: Record<string, Array<{ check: string; reasons: string[]; shared?: string }>> = {
  "darwin/banded-zero-check.ts": [{ check: BANDED_ZERO_CHECK, reasons: [BANDED_ZERO_REASON] }],
  "darwin/canadian-document-check.ts": [{ check: CANADIAN_DOCUMENT_CHECK, reasons: [CANADIAN_DOCUMENT_REASON] }],
  "darwin/card-program-section-check.ts": [{ check: CARD_PROGRAM_SECTION_CHECK, reasons: [CARD_PROGRAM_SECTION_REASON] }],
  "darwin/document-owner.ts": [{ check: DOCUMENT_OWNER_CHECK, reasons: [DOCUMENT_OWNER_REASON] }],
  "darwin/international-direction-check.ts": [{ check: INTERNATIONAL_DIRECTION_CHECK, reasons: [INTERNATIONAL_DIRECTION_REASON] }],
  "darwin/late-charge-bound-check.ts": [{ check: LATE_CHARGE_BOUND_CHECK, reasons: [LATE_CHARGE_BOUND_REASON] }],
  "darwin/line-conflict-check.ts": [{ check: LINE_CONFLICT_CHECK, reasons: [LINE_CONFLICT_REASON_PREFIX] }],
  "darwin/loan-section-check.ts": [{ check: LOAN_SECTION_CHECK, reasons: [LOAN_SECTION_REASON] }],
  "darwin/non-deposit-document-check.ts": [{ check: NON_DEPOSIT_CHECK, reasons: [NON_DEPOSIT_REASON, LENDING_WORDING_REASON, BROKERAGE_DOCUMENT_REASON,
    CARD_PROGRAM_DOCUMENT_REASON, LOAN_TITLED_DOCUMENT_REASON, YOUTH_ACCOUNT_DOCUMENT_REASON, CREDIT_TERMS_DOCUMENT_REASON] }],
  "darwin/product-page-repeat-check.ts": [{ check: PRODUCT_PAGE_REPEAT_CHECK, reasons: [PRODUCT_PAGE_REPEAT_REASON] }],
  "darwin/rate-floor-check.ts": [{ check: RATE_FLOOR_CHECK, reasons: [RATE_FLOOR_REASON] }],
  "darwin/release-repair.ts": [{ check: RELEASE_REPAIR_CHECK, reasons: [RELEASE_REPAIR_REASON_PREFIX] }],
  "darwin/reread-category-check.ts": [{ check: REREAD_CATEGORY_CHECK, reasons: [REREAD_CATEGORY_TWIN_REASON, REREAD_CATEGORY_CHECK] }],
  "darwin/same-line-read-check.ts": [{ check: SAME_LINE_READ_CHECK, reasons: [SAME_LINE_DUPLICATE_REASON], shared: SAME_LINE_DUPLICATE_CHECK }],
  "darwin/same-line-replacement-check.ts": [{ check: SAME_LINE_REPLACEMENT_CHECK, reasons: [SAME_LINE_DUPLICATE_REASON], shared: SAME_LINE_DUPLICATE_CHECK }],
  "darwin/translated-copy-check.ts": [{ check: TRANSLATED_COPY_CHECK, reasons: [TRANSLATED_COPY_REASON] }],
  "darwin/verified-recheck.ts": [{ check: DARWIN_RECHECK_CHECK, reasons: [`${RECHECK_REJECTED_FLAG_PREFIX}:`] }],
  "hamilton/article-page.ts": [{ check: ARTICLE_PAGE_CHECK, reasons: [ARTICLE_PAGE_REASON] }],
  "hamilton/business-schedule.ts": [{ check: BUSINESS_SCHEDULE_CHECK, reasons: [BUSINESS_SCHEDULE_REASON] }],
  "hamilton/category-guard.ts": [{ check: CATEGORY_GUARD_CHECK, reasons: ["category_guard:"] }],
  "hamilton/cross-page-conflict.ts": [{ check: CROSS_PAGE_CHECK, reasons: [CROSS_PAGE_REASON] }],
  "hamilton/current-copy.ts": [{ check: CURRENT_COPY_CHECK, reasons: [`${CURRENT_COPY_REASON}:#`] }],
  // Eval verdicts name each takedown after its verdict kind ("wrong_amount:", "not_a_fee:"), words other
  // producers also write, and the registry's readers match the sync's names for those kinds.
  "hamilton/eval-verdicts.ts": [{ check: EVAL_VERDICT_CHECK, reasons: ["eval_critical", "not_a_fee", "wrong_amount", "wrong_category"], shared: "verdict kinds" }],
  "hamilton/limit-guard.ts": [{ check: LIMIT_GUARD_CHECK, reasons: [LIMIT_GUARD_REASON] }],
  "hamilton/other-bank-document.ts": [
    { check: OTHER_BANK_DOCUMENT_CHECK, reasons: [OTHER_BANK_DOCUMENT_REASON] },
    { check: UNCONFIRMED_HOST_CHECK, reasons: [UNCONFIRMED_HOST_REASON] },
  ],
  "hamilton/product-page-conflict.ts": [{ check: PRODUCT_PAGE_CONFLICT_CHECK, reasons: [PRODUCT_PAGE_CONFLICT_REASON] }],
  "hamilton/product-page.ts": [{ check: PRODUCT_PAGE_CHECK, reasons: [PRODUCT_PAGE_REASON] }],
  "hamilton/restore-recheck.ts": [{ check: RESTORE_RECHECK_CHECK, reasons: [RESTORE_RECHECK_REASON] }],
  "hamilton/rules-recheck.ts": [{ check: RULES_RECHECK_CHECK, reasons: [RULES_RECHECK_REASON] }],
  "hamilton/same-line-duplicates.ts": [{ check: SAME_LINE_DUPLICATE_CHECK, reasons: [SAME_LINE_DUPLICATE_REASON] }],
  "hamilton/source-check.ts": [{ check: SOURCE_CHECK_STRATEGY.strategy, reasons: [SOURCE_CHECK_REASON] }],
  "hamilton/source-link.ts": [
    { check: SOURCE_LINK_CHECK, reasons: [SOURCE_LINK_TAKEDOWN_REASON] },
    { check: SOURCE_LINK_DRIFT_CHECK, reasons: [SOURCE_LINK_DRIFT_REASON] },
  ],
  "hamilton/taxonomy-fold.ts": [{ check: TAXONOMY_FOLD_CHECK, reasons: [TAXONOMY_FOLD_REASON_PREFIX] }],
};

const AGENTS = join(process.cwd(), "src/lib/agents");

function secondLookModules(): string[] {
  const found: string[] = [];
  for (const agent of readdirSync(AGENTS, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const file of readdirSync(join(AGENTS, agent.name))) {
      if (!file.endsWith(".ts") || file.includes(".test.") || file === "second-look.ts") continue;
      if (/\bsecondLook\(/.test(readFileSync(join(AGENTS, agent.name, file), "utf8"))) found.push(`${agent.name}/${file}`);
    }
  }
  return found.sort();
}

describe("a takedown files under the check that made it (#2062)", () => {
  it("lists every module that takes live fees down through a second look", () => {
    // A new check that runs a second look goes in PRODUCERS with its check and reasons, so the line
    // below can pin its reasons to its check.
    expect(secondLookModules()).toEqual(Object.keys(PRODUCERS).sort());
  });

  for (const [file, entries] of Object.entries(PRODUCERS)) {
    for (const { check, reasons, shared } of entries) {
      it(`${file}: its reasons name ${check}`, () => {
        for (const reason of reasons) {
          if (shared) {
            // A shared prefix keeps the sync's own name, never another producer's check.
            expect(takedownCheck(said(reason)), reason).not.toBe(check);
            continue;
          }
          expect(takedownCheck(said(reason)), reason).toBe(check);
        }
      });
    }
  }

  it("maps no prefix that no producer writes, and relabels every name the sync used to give them", () => {
    const written = new Set(Object.values(PRODUCERS).flat().filter((entry) => !entry.shared)
      .flatMap((entry) => entry.reasons.map((reason) => reason.replace(/[:#\s]+$/, "").split(":")[0].trim())));
    expect(Object.keys(TAKEDOWN_REASON_CHECKS).filter((prefix) => !written.has(prefix))).toEqual([]);
    expect(MISFILED_TAKEDOWN_CHECKS).toEqual(Object.keys(TAKEDOWN_REASON_CHECKS).map((prefix) => `hamilton.${prefix}`));
    // The 9 Darwin re-checks named in #2062, and the line conflict and verified re-check found beside them.
    for (const [reason, check] of [["rate_floor: x", RATE_FLOOR_CHECK], ["banded_zero: x", BANDED_ZERO_CHECK],
      ["card_program_section: #1", CARD_PROGRAM_SECTION_CHECK], ["translated_copy: #1 twin #2", TRANSLATED_COPY_CHECK],
      ["document_owner: names institution 3", DOCUMENT_OWNER_CHECK], ["non_deposit_document: x", NON_DEPOSIT_CHECK],
      ["card_program_document: x", NON_DEPOSIT_CHECK], ["product_page_repeat: #1 twin #2", PRODUCT_PAGE_REPEAT_CHECK],
      ["late_charge_bound: x", LATE_CHARGE_BOUND_CHECK], ["release_repair:category_not_in_text_and_disputed", RELEASE_REPAIR_CHECK],
      ["one line, two reads: kept #5 (amount, a: b)", LINE_CONFLICT_CHECK], ["darwin_recheck:name_rule:v9", DARWIN_RECHECK_CHECK]] as const) {
      expect(takedownCheck(reason), reason).toBe(check);
    }
  });
});
