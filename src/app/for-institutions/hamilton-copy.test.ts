import { describe, expect, it } from "vitest";
import { HAMILTON_NAV, HAMILTON_WIRE_NAV } from "@/lib/hamilton/navigation";
import { HAMILTON_TABS } from "./hamilton-copy";

describe("HAMILTON_TABS", () => {
  it("lists the workspace's own tabs in order, the Regulatory Wire last", () => {
    const workspace = [...HAMILTON_NAV.filter((i) => i.label !== "Admin").map((i) => i.label), HAMILTON_WIRE_NAV.label];
    expect(HAMILTON_TABS.map((t) => t.label)).toEqual(workspace);
  });

  it("keeps the retired tool names and advice words off the page", () => {
    const text = HAMILTON_TABS.map((t) => `${t.label} ${t.line}`).join(" ");
    for (const word of ["Benchmark", "Analyze", "Monitor", "recommend", "real-time"]) {
      expect(text).not.toContain(word);
    }
  });
});
