import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { formatLocalDate, LocalDate } from "./LocalDate";

// James asked at 7:30 pm Pacific on Oct 15, which is 02:30 UTC on Oct 16 (#1541, #1542).
const ASKED = "2026-10-16T02:30:00Z";
const SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

describe("LocalDate (#1541)", () => {
  it("renders the same UTC date on the server whatever the server's zone, so hydration matches", () => {
    expect(renderToString(<LocalDate iso={ASKED} options={SHORT} />)).toBe('<time dateTime="2026-10-16T02:30:00Z">Oct 16</time>');
  });
  it("formats in the reader's zone once on the client", () => {
    expect(formatLocalDate(ASKED, SHORT, "America/Los_Angeles")).toBe("Oct 15");
    expect(formatLocalDate("not a date", SHORT)).toBe("");
  });
});
