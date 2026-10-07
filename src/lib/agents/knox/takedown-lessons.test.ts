import { describe, expect, it, vi } from "vitest";
import {
  KNOX_READ_CHECKS,
  loadTakedownLessons,
  takedownKey,
  takedownLessonFlag,
  takedownLessonFor,
} from "@/lib/agents/knox/takedown-lessons";

describe("Knox takedown lessons", () => {
  const lessons = new Map([[takedownKey(7, "Daily ATM Limits ($/#)", 505), "hamilton.source_check"]]);

  it("matches the same bank, name and price, however the name is punctuated", () => {
    expect(takedownLessonFor({ feeName: "daily atm limits", amount: 505 }, lessons, 7)).toBe("hamilton.source_check");
    expect(takedownLessonFor({ feeName: "Daily ATM Limits ($/#)", amount: 505.0 }, lessons, 7)).toBe("hamilton.source_check");
  });

  it("does not match another bank or another price", () => {
    expect(takedownLessonFor({ feeName: "Daily ATM Limits ($/#)", amount: 505 }, lessons, 8)).toBeNull();
    expect(takedownLessonFor({ feeName: "Daily ATM Limits ($/#)", amount: 500 }, lessons, 7)).toBeNull();
    expect(takedownLessonFor({ feeName: "Daily ATM Limits ($/#)", amount: 505 }, new Map(), 7)).toBeNull();
  });

  it("names the confirming check in the row's flag", () => {
    expect(takedownLessonFlag("hamilton.limit_guard")).toBe("knox_lesson:taken_down:hamilton.limit_guard");
  });

  it("reads only second-look confirmations of read faults, and skips fees live again", async () => {
    const texts: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("$1");
      texts.push(text);
      return Promise.resolve(text.includes("to_regclass") ? [{ ready: true }] : []);
    });
    await loadTakedownLessons(db as never);
    const query = (texts.find((text) => text.includes("pipeline_feedback f")) ?? "").replace(/\s+/g, " ");
    expect(query).toContain("f.kind = 'takedown_confirmed'");
    expect(query).toContain("fp.rolled_back_at IS NOT NULL");
    expect(query).toContain("live.rolled_back_at IS NULL");
    expect(KNOX_READ_CHECKS).not.toContain("hamilton.category_guard");
    for (const kind of ["not_on_schedule", "wrong_amount", "threshold", "unreproduced"]) expect(query).not.toContain(`'${kind}'`);
  });
});
