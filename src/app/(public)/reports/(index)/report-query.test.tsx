import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishedResearch, RequestSection, filterReports, type PublishedReportItemView } from "./report-query";

// /reports reads its query in the browser so the page itself can be prerendered (#1811).
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-18T12:00:00Z");

function item(id: string, type: string, daysAgo: number): PublishedReportItemView {
  return {
    id,
    report_type: type,
    slug: `r-${id}`,
    title: `Report ${id}`,
    published_at: new Date(NOW - daysAgo * DAY).toISOString(),
    ago: `${daysAgo}d ago`,
  };
}

const REPORTS = [item("a", "national_index", 5), item("b", "state_index", 40), item("c", "national_index", 200)];

function sections() {
  render(
    <>
      <RequestSection kind="paid" aria-labelledby="p">paid</RequestSection>
      <RequestSection kind="free" aria-labelledby="f">free</RequestSection>
    </>,
  );
  return { paid: screen.getByText("paid"), free: screen.getByText("free") };
}

describe("/reports query islands", () => {
  it("lands #request on the paid form by default", () => {
    params = new URLSearchParams();
    const { paid, free } = sections();
    expect(paid.id).toBe("request");
    expect(free.id).toBe("free-reports");
  });

  it("lands #request on the free form when a link asks for a free report", () => {
    params = new URLSearchParams({ report: "district" });
    const { paid, free } = sections();
    expect(paid.id).toBe("institution-request");
    expect(free.id).toBe("request");
  });

  it("filters by known type and range only", () => {
    const filters = (type: string | null, range?: string) => ({
      typeFilter: type,
      rawRange: range,
      rangeDays: range ? ({ "30d": 30, "90d": 90, "365d": 365 } as Record<string, number>)[range] ?? null : null,
    });
    expect(filterReports(REPORTS, filters("national_index"), NOW).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterReports(REPORTS, filters(null, "90d"), NOW).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterReports(REPORTS, filters("national_index", "30d"), NOW).map((r) => r.id)).toEqual(["a"]);
  });

  it("applies ?type= in the browser and ignores an unknown type", () => {
    params = new URLSearchParams({ type: "state_index" });
    const { unmount } = render(<PublishedResearch reports={REPORTS} unavailable={false} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Report b")).toBeInTheDocument();
    unmount();

    params = new URLSearchParams({ type: "drop table" });
    render(<PublishedResearch reports={REPORTS} unavailable={false} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says when no report matches the filters", () => {
    params = new URLSearchParams({ type: "peer_brief" });
    render(<PublishedResearch reports={REPORTS} unavailable={false} />);
    expect(screen.getByText("No published reports match these filters.")).toBeInTheDocument();
  });
});
