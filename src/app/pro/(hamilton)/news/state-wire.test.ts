import { describe, expect, it } from "vitest";
import type { WireParams } from "@/lib/regulatory/wire";
import { emptyMessage, struckRegulatorNote, struckStatesInView } from "./state-wire";

const base: WireParams = { view: "states", range: "month", q: "", page: 1 };
const struckTerms = "website terms do not allow commercial use.";

describe("States wire empty messages", () => {
  it("promise no press coverage while it is held", () => {
    const all = emptyMessage(base, "any state", "this month");
    expect(all).toContain("no fee bills or regulator posts");
    expect(all).toContain("regulator posts are read once a day.");
    expect(all.toLowerCase()).not.toContain("press");
    expect(emptyMessage({ ...base, kind: "press" }, "any state", "this month")).toBe("Press coverage is paused while we confirm its license.");
  });

  it("say why a struck state's regulator posts are missing", () => {
    for (const state of ["NY", "NC", "FL"]) {
      const message = emptyMessage({ ...base, state, kind: "regulators" }, state, "this month");
      expect(message).toContain("regulator posts are not shown because the regulator's website terms do not allow commercial use.");
      expect(message).not.toContain("read once a day");
    }
    expect(emptyMessage({ ...base, state: "TX", kind: "regulators" }, "Texas", "this month")).toContain("Regulator posts are read once a day.");
  });

  it("should_name_struck_states_when_my_states_holds_only_struck_states", () => {
    const message = emptyMessage({ ...base, mine: true, kind: "regulators" }, "your watched states", "this month", ["NY"]);
    expect(message).toContain("New York regulator posts are not shown");
    expect(message).toContain(struckTerms);
    expect(message).not.toContain("read once a day");
  });

  it("should_name_struck_states_and_keep_the_schedule_when_my_states_is_mixed", () => {
    const message = emptyMessage({ ...base, mine: true, kind: "regulators" }, "your watched states", "this month", ["FL", "NY", "TX"]);
    expect(message).toContain("Florida and New York regulator posts are not shown");
    expect(message).toContain("Other states' regulator posts are read once a day.");
  });

  it("should_say_nothing_of_struck_states_when_my_states_holds_none", () => {
    const message = emptyMessage({ ...base, mine: true, kind: "regulators" }, "your watched states", "this month", ["TX", "CA"]);
    expect(message).toContain("Regulator posts are read once a day.");
    expect(message).not.toContain(struckTerms);
  });

  it("should_name_every_struck_state_on_all_states", () => {
    const message = emptyMessage({ ...base, kind: "regulators" }, "any state", "this month");
    expect(message).toContain("New York, North Carolina and Florida regulator posts are not shown");
    expect(message).toContain("Other states' regulator posts are read once a day.");
  });
});

describe("struckStatesInView", () => {
  it("should_return_the_chosen_state_only_when_it_is_struck", () => {
    expect(struckStatesInView({ ...base, state: "NY" })).toEqual(["NY"]);
    expect(struckStatesInView({ ...base, state: "TX" })).toEqual([]);
  });

  it("should_return_the_struck_watched_states_on_my_states", () => {
    expect(struckStatesInView({ ...base, mine: true }, ["CA", "NC", "NY"])).toEqual(["NC", "NY"]);
  });

  it("should_return_every_struck_state_on_all_states", () => {
    expect(struckStatesInView(base)).toEqual(["NY", "NC", "FL"]);
    // My states with nothing watched opens on All states.
    expect(struckStatesInView({ ...base, mine: true }, [])).toEqual(["NY", "NC", "FL"]);
  });
});

describe("struckRegulatorNote", () => {
  it("should_return_null_when_no_state_is_struck", () => {
    expect(struckRegulatorNote([])).toBeNull();
  });

  it("should_use_plural_regulators_for_several_states", () => {
    expect(struckRegulatorNote(["NC", "NY"])).toBe(
      "North Carolina and New York regulator posts are not shown because those regulators' website terms do not allow commercial use.",
    );
  });
});
