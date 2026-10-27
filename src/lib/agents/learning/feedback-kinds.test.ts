import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { FEEDBACK_KINDS, feedbackRowRead, feedbackRowReaders, unreadFeedbackPredicate, type FeedbackKindEntry } from "./feedback-kinds";
import { KNOX_READ_CHECKS } from "@/lib/agents/knox/takedown-lessons";
import { READ_WRONG_CHECKS } from "@/lib/agents/magellan/outcomes";
import { takedownKind } from "./feedback";
import { unreadFeedbackLines } from "./unread-feedback";

const UNREAD_KINDS_CEILING = 14;
const entries = Object.entries(FEEDBACK_KINDS) as Array<[string, FeedbackKindEntry]>;

describe("every feedback kind names its reader (#2062)", () => {
  it("lists readers that exist, and says why a kind with none is unread or only a record", () => {
    for (const [kind, entry] of entries) {
      expect(kind).toMatch(/^[a-z][a-z0-9_]*$/);
      if ("readers" in entry) {
        expect(entry.readers.length, kind).toBeGreaterThan(0);
        for (const file of entry.readers) expect(existsSync(join(process.cwd(), file)), `${kind}: ${file}`).toBe(true);
      } else {
        const reason = "unread" in entry ? entry.unread : entry.record;
        expect(reason.length, kind).toBeGreaterThan(10);
      }
    }
  });

  it("never lets the list of unread kinds grow: a new kind comes with its reader", () => {
    // The kinds still unread when the registry was built (#2062). Give one a reader and lower this;
    // never raise it.
    const unread = entries.filter(([, entry]) => "unread" in entry).map(([kind]) => kind);
    expect(unread.length).toBeLessThanOrEqual(UNREAD_KINDS_CEILING);
  });

  it("registers every kind the takedown sync maps a reason to", () => {
    const reasons = ["refreshed by #1", "rules_recheck_unreproduced", "category_guard", "amount_outside_category_range", "category_outside_taxonomy",
      "limit_as_fee", "duplicate of #2", "source_check_untraceable:amount_is_a_threshold", "source_check_untraceable:amount_not_the_fee",
      "source_check_untraceable:priced_per_amount", "source_check_untraceable:category_not_in_text", "source_check_untraceable:discontinued_account", "source_check_untraceable:other"];
    for (const reason of reasons) expect(Object.keys(FEEDBACK_KINDS), reason).toContain(takedownKind(reason));
    // #2070: a discontinued account's takedown is its own kind, not "not on the schedule".
    expect(takedownKind("source_check_untraceable:discontinued_account")).toBe("discontinued_account");
  });

  it("calls a row unread when its kind is unread or unregistered, or read only at another stage or from other checks", () => {
    expect(feedbackRowRead({ kind: "made_up_kind", about_stage: "discover", check_name: "x" })).toBe(false);
    // Magellan reads its search misses and Hamilton's conflict lessons (#2062).
    expect(feedbackRowRead({ kind: "search_miss", about_stage: "discover", check_name: "magellan.search_miss" })).toBe(true);
    expect(feedbackRowRead({ kind: "stale_price", about_stage: "publish", check_name: "hamilton.cross_page_conflict" })).toBe(true);
    expect(feedbackRowRead({ kind: "schedule_conflict", about_stage: "publish", check_name: "hamilton.product_page_conflict" })).toBe(true);
    expect(feedbackRowRead({ kind: "flag_cleared", about_stage: "publish", check_name: "x" })).toBe(true);
    expect(feedbackRowRead({ kind: "audit_miss", about_stage: "discover", check_name: "hamilton.other_bank_document" })).toBe(true);
    expect(feedbackRowRead({ kind: "audit_miss", about_stage: "extract", check_name: "hamilton.source_check" })).toBe(false);
    // Knox reads extract findings that say something about the category (lessons.ts v5).
    expect(FEEDBACK_KINDS.audit_miss.readers).toContain("src/lib/agents/knox/lessons.ts");
    expect(feedbackRowRead({ kind: "audit_miss", about_stage: "extract", check_name: "hamilton.category_guard" })).toBe(true);
    expect(feedbackRowRead({ kind: "admin_correction", about_stage: "extract", check_name: "admin.fee_correction", cause: "wrong_category" })).toBe(true);
    expect(feedbackRowRead({ kind: "admin_correction", about_stage: "extract", check_name: "hamilton.admin_correction" })).toBe(false);
    expect(feedbackRowRead({ kind: "admin_hold", about_stage: "extract", check_name: "admin.fee_hold", cause: "wrong_category" })).toBe(true);
    expect(feedbackRowRead({ kind: "admin_hold", about_stage: "extract", check_name: "admin.fee_hold", cause: "wrong_amount" })).toBe(false);
    // Darwin reads a person's own holds and corrections filed against verify (#2057), nothing else there.
    expect(feedbackRowRead({ kind: "audit_miss", about_stage: "verify", check_name: "hamilton.source_check", reported_by: "deming" })).toBe(false);
    expect(feedbackRowRead({ kind: "admin_hold", about_stage: "verify", check_name: "admin.fee_hold", reported_by: "human" })).toBe(true);
    expect(feedbackRowRead({ kind: "admin_correction", about_stage: "verify", check_name: "admin.fee_correction", reported_by: "human" })).toBe(true);
    expect(feedbackRowRead({ kind: "admin_correction", about_stage: "verify", check_name: "admin.fee_correction", reported_by: "hamilton" })).toBe(false);
    expect(feedbackRowRead({ kind: "admin_correction", about_stage: "verify", check_name: "admin.fee_correction" })).toBe(false);
    expect(feedbackRowRead({ kind: "admin_hold", about_stage: "verify", check_name: "hamilton.other", reported_by: "human" })).toBe(false);
    expect(feedbackRowRead({ kind: "admin_correction", about_stage: "verify", check_name: "hamilton.admin_correction", reported_by: "gutenberg", dedupe_key: "hamilton.takedown:pub:9:verify" })).toBe(false);
    expect(feedbackRowRead({ kind: "admin_correction", about_stage: "publish", check_name: "admin.fee_correction", reported_by: "human" })).toBe(false);
    // The narrowing is per stage: Rosetta's read-stage rows keep their own rule.
    expect(feedbackRowRead({ kind: "admin_hold", about_stage: "read", check_name: "admin.fee_hold" })).toBe(true);
    expect(feedbackRowRead({ kind: "wrong_document", about_stage: "discover", check_name: "magellan.link_yield" })).toBe(true);
    expect(feedbackRowRead({ kind: "wrong_document", about_stage: "discover", check_name: "hamilton.article_page" })).toBe(false);
    // A takedown's verify row is read by nobody when the sync is the kind's only reader (#2062 review).
    expect(feedbackRowRead({ kind: "wrong_amount", about_stage: "verify", check_name: "hamilton.source_check", dedupe_key: "hamilton.takedown:pub:9:verify" })).toBe(false);
    expect(feedbackRowRead({ kind: "wrong_amount", about_stage: "extract", check_name: "hamilton.source_check", dedupe_key: "hamilton.takedown:pub:9:extract" })).toBe(true);
    // Release review reads the category guard's rows at any stage; Knox reads only extract.
    expect(feedbackRowRead({ kind: "wrong_category", about_stage: "verify", check_name: "hamilton.category_guard:v2" })).toBe(true);
    expect(feedbackRowRead({ kind: "wrong_category", about_stage: "verify", check_name: "hamilton.source_check" })).toBe(false);
    expect(feedbackRowRead({ kind: "wrong_category", about_stage: "publish", check_name: "hamilton.account_type_hold" })).toBe(false);
    // The takedown sync's open-ended kinds: its restore detection reads the extract rows only.
    expect(feedbackRowRead({ kind: "product_page", about_stage: "extract", check_name: "hamilton.product_page", dedupe_key: "hamilton.takedown:pub:9:extract" })).toBe(true);
    expect(feedbackRowRead({ kind: "product_page", about_stage: "verify", check_name: "hamilton.product_page", dedupe_key: "hamilton.takedown:pub:9:verify" })).toBe(false);
  });

  it("splits the registry for the brief's query the same way", () => {
    const { unreadKinds, partial, stageOnly, registered } = unreadFeedbackPredicate();
    expect(unreadKinds).not.toContain("search_miss");
    expect(unreadKinds).not.toContain("stale_price");
    expect(unreadKinds).not.toContain("schedule_conflict");
    expect(partial).toContainEqual({ kind: "audit_miss", stages: ["discover", "extract"], checks: ["hamilton.source_check", "hamilton.product_page_conflict", "deming.not_a_fee_line", "deming.name_quality"], anyStageChecks: [], causes: [] });
    expect(partial).toContainEqual(expect.objectContaining({ kind: "admin_hold", causes: ["wrong_amount"] }));
    expect(partial).toContainEqual({ kind: "admin_correction", stages: ["discover", "read", "extract", "verify"], checks: ["hamilton.admin_correction"], anyStageChecks: [], causes: [] });
    const handRows = { stage: "verify", checks: ["admin.fee_hold", "admin.fee_correction"], reportedBy: ["human"] };
    expect(stageOnly).toEqual([{ kind: "admin_hold", ...handRows }, { kind: "admin_correction", ...handRows }]);
    // Every kind with a stageOnly rule is in the partial list the query joins.
    for (const item of stageOnly) expect(partial.map((p) => p.kind)).toContain(item.kind);
    expect(new Set(registered)).toEqual(new Set(Object.keys(FEEDBACK_KINDS)));
  });

  it("always gives the brief one line, zero included", () => {
    expect(unreadFeedbackLines(undefined)).toEqual([]);
    expect(unreadFeedbackLines(null)).toEqual(["Error rows no agent reads: count unavailable today."]);
    expect(unreadFeedbackLines({ total: 0, byKind: [] })[0]).toContain(": none.");
    const line = unreadFeedbackLines({ total: 1500, byKind: [{ kind: "audit_miss", stage: "extract", rows: 1200 }, { kind: "search_miss", stage: "discover", rows: 300 }] }, 1)[0];
    expect(line).toBe("Error rows no agent reads (last 30 days, older than 48 hours): 1,500: audit_miss at extract 1,200, and 1 more kinds.");
  });
});

describe("which reader reads a row, by its stage and check (#2066)", () => {
  const KNOX = "src/lib/agents/knox/lessons.ts";
  const RELEASE = "src/lib/agents/darwin/release-review.ts";

  it("scopes only registered readers, and agrees with each reader's own check list", () => {
    for (const [kind, entry] of entries) {
      if (!("readers" in entry) || !entry.readerScopes) continue;
      for (const file of Object.keys(entry.readerScopes)) expect(entry.readers, `${kind}: ${file}`).toContain(file);
    }
    const confirmed = FEEDBACK_KINDS.takedown_confirmed.readerScopes;
    expect([...confirmed["src/lib/agents/knox/takedown-lessons.ts"].checks].sort()).toEqual([...KNOX_READ_CHECKS].sort());
    expect([...confirmed["src/lib/agents/magellan/outcomes.ts"].checks].sort()).toEqual([...READ_WRONG_CHECKS].sort());
  });

  it("names the reader of the row's own stage or check, not every reader of the kind", () => {
    // The category guard's verify row is read by release review only; its extract row by Knox too.
    expect(feedbackRowReaders({ kind: "wrong_category", about_stage: "verify", check_name: "hamilton.category_guard:v80" })).toEqual([RELEASE]);
    expect(feedbackRowReaders({ kind: "wrong_category", about_stage: "extract", check_name: "hamilton.category_guard" })).toEqual([KNOX, "src/lib/agents/knox/label-queue.ts", RELEASE]);
    expect(feedbackRowReaders({ kind: "wrong_category", about_stage: "extract", check_name: "knox.lessons" })).toEqual([KNOX, "src/lib/agents/knox/label-queue.ts"]);
    // A person's hold goes to the reader of the stage it names.
    expect(feedbackRowReaders({ kind: "admin_hold", about_stage: "read", check_name: "admin.fee_hold" })).toEqual(["src/lib/agents/rosetta/read.ts"]);
    expect(feedbackRowReaders({ kind: "admin_hold", about_stage: "discover", check_name: "admin.fee_hold" })).toEqual(["src/lib/agents/magellan/discovery.ts"]);
    expect(feedbackRowReaders({ kind: "admin_correction", about_stage: "verify", check_name: "admin.fee_correction", reported_by: "human" })).toEqual(["src/lib/agents/darwin/verify-misses.ts"]);
    // Unread rows have no reader; an unscoped kind keeps all its readers.
    expect(feedbackRowReaders({ kind: "admin_hold", about_stage: "extract", check_name: "admin.fee_hold", cause: "wrong_amount" })).toEqual([]);
    expect(feedbackRowReaders({ kind: "frequency_filled", about_stage: "extract", check_name: "darwin.hourly_frequency_check" })).toEqual([]);
    expect(feedbackRowReaders({ kind: "flag_cleared", about_stage: "publish", check_name: "x" })).toEqual([]);
    expect(feedbackRowReaders({ kind: "made_up", about_stage: "extract", check_name: null, dedupe_key: "hamilton.takedown:pub:9:extract" })).toEqual(["src/lib/agents/learning/feedback-sync.ts"]);
    expect(feedbackRowReaders({ kind: "search_miss", about_stage: "discover", check_name: "magellan.search_miss" })).toEqual([...FEEDBACK_KINDS.search_miss.readers]);
    // Confirmed takedowns: Knox's takedown lessons read the source check, limit guard and business schedule only.
    expect(feedbackRowReaders({ kind: "takedown_confirmed", about_stage: "publish", check_name: "hamilton.category_guard" })).toEqual(["src/lib/agents/deming/regression.ts"]);
  });
});
