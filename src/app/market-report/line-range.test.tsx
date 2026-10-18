import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { LineRange } from "./report-body";

function line(own: number | null, comparable = true): ReportLine {
  return {
    key: "od",
    label: "Overdraft",
    own: own === null ? null : { amount: own, fee_name: "od", source_url: null, updated_at: null, schedule_read_on: null, source_line: "od" },
    peers: { n: 12, p25: 20, median: 25, p75: 30, min: 10, max: 40 },
    comparable,
    position: own === null ? null : "above_market",
    percentile: 80,
    chargingLess: 9,
    peerFigures: [],
  };
}

function left(el: Element): number {
  return parseFloat((el as HTMLElement).style.left);
}

describe("LineRange", () => {
  it("draws the institution's dot past the middle half when it charges more", () => {
    const { container } = render(<LineRange line={line(50)} />);
    const [band, tick, dot] = [...container.querySelectorAll("span[style]")];
    expect(left(band)).toBeGreaterThan(0);
    expect(left(tick)).toBeGreaterThan(left(band));
    expect(left(dot)).toBeGreaterThan(left(tick));
    expect(left(dot)).toBeLessThan(100);
    // The institution is brick and the peers' middle 50% is neutral, whatever its position.
    expect(dot.className).toContain("bg-brick");
    expect(band.className).toContain("bg-surface-200");
  });

  it("draws nothing for a line that can't be compared", () => {
    expect(render(<LineRange line={line(null)} />).container.innerHTML).toBe("");
    expect(render(<LineRange line={line(30, false)} />).container.innerHTML).toBe("");
  });
});
