import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeeRange } from "./FeeRange";

const row = { label: "Local competitors", min: 5, q1: 25, median: 30, q3: 34, max: 37 };
const figure = (html: string) => html.match(/fi-range-value">([^<]*)</)?.[1];

describe("FeeRange", () => {
  it("prints the bank's fee at the right by default", () => {
    expect(figure(renderToStaticMarkup(<FeeRange {...row} value={10} />))).toBe("$10.00");
  });

  it("prints the market median when a ladder asks for it, keeping the bank's dot", () => {
    const html = renderToStaticMarkup(<FeeRange {...row} value={10} figure="median" />);
    expect(figure(html)).toBe("$30.00");
    expect(html).toContain('class="you"');
  });

  it("names the dot 'this bank' to screen readers unless told otherwise", () => {
    expect(renderToStaticMarkup(<FeeRange {...row} value={10} />)).toContain("this bank $10.00");
    const html = renderToStaticMarkup(<FeeRange {...row} value={10} subjectLabel="your fee" spread={{ min: 0, max: 400 }} />);
    expect(html).toContain("market $0.00 to $400.00");
    expect(html).toContain("your fee $10.00");
    expect(html).not.toContain("this bank");
  });
});
