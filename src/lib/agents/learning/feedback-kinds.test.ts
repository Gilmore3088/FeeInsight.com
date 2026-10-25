import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { FEEDBACK_KINDS, feedbackRowRead, unreadFeedbackPredicate, type FeedbackKindEntry } from "./feedback-kinds";
import { takedownKind } from "./feedback";
import { unreadFeedbackLines } from "./unread-feedback";

const UNREAD_KINDS_CEILING = 17;
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
    expect(feedbackRowRead({ kind: "search_miss", about_stage: "discover", check_name: "magellan.search_miss" })).toBe(false);
    expect(feedbackRowRead({ kind: "flag_cleared", about_stage: "publish", check_name: "x" })).toBe(true);
    expect(feedbackRowRead({ kind: "audit_miss", about_stage: "discover", check_name: "hamilton.other_bank_document" })).toBe(true);
    expect(feedbackRowRead({ kind: "audit_miss", about_stage: "extract", check_name: "hamilton.source_check" })).toBe(false);
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
    const { unreadKinds, partial, registered } = unreadFeedbackPredicate();
    expect(unreadKinds).toContain("search_miss");
    expect(partial).toContainEqual({ kind: "audit_miss", stages: ["discover"], checks: [], anyStageChecks: [] });
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
