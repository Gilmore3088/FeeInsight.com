import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccuracyHistoryPanel } from "./accuracy-history";
import { poolAccuracyDays } from "@/lib/agents/deming/accuracy-measure";

describe("accuracy history presentation", () => {
  it("keeps an old 100% score visibly legacy, without a confidence interval or met claim", () => {
    const html = renderToStaticMarkup(<AccuracyHistoryPanel history={{ weeks: [{
      ...poolAccuracyDays([{ at: "2026-10-12T00:00:00Z", right: 5000, scorable: 5000, accuracy: 1, amount: 0, category: 0, evidence: 0, notAFee: 0, name: 0 }]),
      weekStart: "2026-10-12", partial: false, scoringChanged: true,
    }] }} />);
    expect(html).toContain("Legacy — versions unknown");
    expect(html).toContain("Scoring changed — new series");
    expect(html).toContain("legacy — scoring versions or per-fee receipts unavailable");
    expect(html).not.toContain("met on the 95% lower bound");
    expect(html).toContain('scope="col"');
    expect(html).toContain("3,400 unique scorable fees");
    expect(html).toContain("does not measure missing fees");
  });

  it("shows history read failures instead of a zero or empty healthy week", () => {
    expect(renderToStaticMarkup(<AccuracyHistoryPanel history={null} />)).toContain("Audit history could not be read");
  });
});
