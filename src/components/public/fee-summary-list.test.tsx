import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeeSummaryList, middleHalfLabel, stripScale } from "./fee-summary-list";
import { ScrollTable } from "./scroll-table";

describe("FeeSummaryList", () => {
  it("states each fee's median, middle half and institution count in text", () => {
    const html = renderToStaticMarkup(
      <FeeSummaryList
        label="Overdraft fees"
        items={[{ key: "overdraft", label: "Overdraft (OD)", href: "/fees/overdraft", median: 30, p25: 25, p75: 34, institutions: 2533 }]}
      />,
    );
    expect(html).toContain("Overdraft (OD)");
    expect(html).toContain("$30");
    expect(html).toContain("Middle half $25–$34");
    expect(html).toContain("2,533 institutions");
    // The strip is a picture of the same figures, so a key with its endpoints sits beside it.
    expect(html).toContain("Strips run $0 to");
  });

  it("says so when there are too few institutions for a median, instead of drawing a blank", () => {
    const html = renderToStaticMarkup(
      <FeeSummaryList label="Districts" items={[{ key: "d9", label: "Minneapolis", median: null, p25: null, p75: null, institutions: 3 }]} />,
    );
    expect(html).toContain("Middle half not available");
    expect(html).toContain("3 institutions");
    expect(html).toContain("not enough institutions yet for a median");
  });
});

describe("helpers", () => {
  it("labels a missing middle half plainly", () => {
    expect(middleHalfLabel(undefined, 10)).toBe("Middle half not available");
  });

  it("rounds the strip scale up to a round figure above the largest 75th percentile", () => {
    expect(stripScale([{ median: 30, p75: 34 }, { median: 6, p75: 10 }])).toBe(50);
    expect(stripScale([])).toBe(1);
  });
});

describe("ScrollTable", () => {
  it("is a named, keyboard-focusable scroll region with a written cue", () => {
    const html = renderToStaticMarkup(
      <ScrollTable label="Overdraft fee by Federal Reserve district">
        <tbody>
          <tr>
            <td>Boston</td>
          </tr>
        </tbody>
      </ScrollTable>,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Overdraft fee by Federal Reserve district (scrolls sideways)"');
    expect(html).toContain("Scroll sideways to see every column");
  });
});
