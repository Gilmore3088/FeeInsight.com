import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SampleLines, StateReportMap } from "./report-exhibits";
import type { SampleExhibit } from "./report-view";

const sample: SampleExhibit = {
  name: "Capital City Bank",
  place: "Tallahassee, FL",
  competitorsWithData: 18,
  competitorsInMarket: 30,
  findings: [],
  readOn: "2026-10-03",
  lines: [
    { key: "od", label: "Overdraft", own: 35, p25: 25, median: 30, p75: 32, peers: 14, chargingLess: 11, position: "above_market" },
    { key: "nsf", label: "NSF", own: 25, p25: 20, median: 28, p75: 30, peers: 12, chargingLess: 3, position: "in_market" },
  ],
};

describe("reports page exhibits", () => {
  it("counts the competitors charging less on the tapped fee", () => {
    render(<SampleLines sample={sample} />);
    expect(screen.getByText("11")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^NSF: \$25/ }));
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("NSF · Capital City Bank $25")).toBeTruthy();
    expect(screen.getByText(/of the 12 local competitors publishing this fee charge less\. Local median \$28\./)).toBeTruthy();
  });

  it("opens on the best-covered state and switches from the picker", () => {
    render(
      <StateReportMap
        states={[
          { code: "FL", name: "Florida", institutions: 160, fees: 3000, shade: 4, reportReady: true },
          { code: "VT", name: "Vermont", institutions: 6, fees: 40, shade: 1, reportReady: false },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Open the Florida report" }).getAttribute("href")).toBe("/research/state/FL");
    expect(screen.getByRole("link", { name: "Request a report for your Florida institution" }).getAttribute("href")).toBe(
      "/reports?report=institution&src=reports-map-FL#request",
    );
    fireEvent.change(screen.getByLabelText("Pick a state"), { target: { value: "VT" } });
    expect(screen.getByRole("link", { name: "Open the Vermont report" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Request a report for your/ })).toBeNull();
  });
});
