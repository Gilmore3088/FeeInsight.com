import { describe, expect, it } from "vitest";
import type { WireParams } from "@/lib/regulatory/wire";
import { emptyMessage } from "./state-wire";

const base: WireParams = { view: "states", range: "month", q: "", page: 1 };

describe("States wire empty messages", () => {
  it("promise no press coverage while it is held", () => {
    const all = emptyMessage(base, "any state", "this month");
    expect(all).toContain("no fee bills or regulator posts");
    expect(all).toContain("Regulator posts are read once a day.");
    expect(all.toLowerCase()).not.toContain("press");
    expect(emptyMessage({ ...base, kind: "press" }, "any state", "this month")).toBe("Press coverage is paused while we confirm its licence.");
  });

  it("say why a struck state's regulator posts are missing", () => {
    for (const state of ["NY", "NC", "FL"]) {
      const message = emptyMessage({ ...base, state, kind: "regulators" }, state, "this month");
      expect(message).toContain("regulator posts are not shown because the regulator's website terms do not allow commercial use.");
      expect(message).not.toContain("read once a day");
    }
    expect(emptyMessage({ ...base, state: "TX", kind: "regulators" }, "Texas", "this month")).toContain("Regulator posts are read once a day.");
  });
});
