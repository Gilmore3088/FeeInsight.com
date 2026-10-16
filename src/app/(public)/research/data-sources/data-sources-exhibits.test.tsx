import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { DataSourcesHero, MethodologyLine, NextAction, SourceMap, SourceTable } from "./data-sources-exhibits";
import { DATA_SOURCES, coverageBar, nextAction, sourceMap } from "./data-sources-view";

describe("SourceMap", () => {
  it("links every node to its table row and draws only the counts it was given", () => {
    render(
      <SourceMap
        map={sourceMap({ observations: 1000, institutions: null, banks: 0, creditUnions: 4321, fdicReports: null, ncuaReports: null })}
        coverage={null}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "One primary source, and the data around it" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /On our list/ })).not.toBeInTheDocument();
    const primary = screen.getByRole("link", { name: /Institution fee schedules/ });
    expect(primary).toHaveAttribute("href", "#fee-schedules");
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.queryByText("institutions with published fees")).not.toBeInTheDocument();
    expect(screen.getByText("4,321")).toBeInTheDocument();
    expect(screen.queryByText("banks on our list")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    const groups = within(screen.getByRole("list", { name: "Supporting sources" }));
    expect(groups.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Who we track",
      "Regulation",
      "Financials",
      "Context",
      "Regions",
    ]);
    for (const s of DATA_SOURCES.slice(1)) {
      expect(screen.getByRole("link", { name: new RegExp(`^${s.name}`) })).toHaveAttribute("href", `#${s.id}`);
    }
  });
});

describe("CoverageBar", () => {
  it("draws the list and the published share on one scale with the real counts", () => {
    const counts = { observations: null, institutions: 3000, banks: 4000, creditUnions: 6000, fdicReports: null, ncuaReports: null };
    render(<SourceMap map={sourceMap(counts)} coverage={coverageBar(counts)} />);
    expect(screen.getByRole("img", { name: "On our list: 4,000 banks and 6,000 credit unions" })).toBeInTheDocument();
    const share = screen.getByRole("img", { name: "3,000 institutions with published fees, 30% of the list" });
    expect((share.firstChild as HTMLElement).style.width).toBe("30%");
    expect(screen.getByText("30% of the institutions on our list have published fees")).toBeInTheDocument();
  });
});

describe("SourceTable", () => {
  it("gives each source a row with its anchor, refresh and site link", () => {
    const { container } = render(<SourceTable sources={DATA_SOURCES} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(DATA_SOURCES.length + 1);
    for (const s of DATA_SOURCES) {
      const row = container.querySelector(`tr#${s.id}`);
      expect(row).not.toBeNull();
      if (s.href) {
        expect(within(row as HTMLElement).getByRole("link", { name: `Visit ${s.name}` })).toHaveAttribute("href", s.href);
      }
    }
    expect(screen.getByText("Each institution's site")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[\u2014\u2013]/);
  });

  it("leaves the refresh cell empty when the code states none", () => {
    const { container } = render(<SourceTable sources={[{ ...DATA_SOURCES[1], refresh: null }]} />);
    expect(container.querySelector('[data-cell="refresh"]')?.textContent).toBe("");
  });

  it("prefixes the refresh on phones, where the column heading is hidden", () => {
    const { container } = render(<SourceTable sources={[DATA_SOURCES[1]]} />);
    expect(container.querySelector('[data-cell="refresh"]')?.textContent).toBe(`Refreshed: ${DATA_SOURCES[1].refresh}`);
  });
});

describe("page chrome", () => {
  it("hero hides the freshness line when it is unknown", () => {
    render(<DataSourcesHero freshnessLabel={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Where every number comes from" })).toBeInTheDocument();
    expect(screen.queryByText(/Data refresh/)).not.toBeInTheDocument();
  });

  it("links to the methodology", () => {
    render(<MethodologyLine />);
    expect(screen.getByRole("link", { name: "read the methodology" })).toHaveAttribute("href", "/methodology");
  });

  it("offers one next step and the demo", () => {
    render(<NextAction action={nextAction(false)} />);
    expect(screen.getByRole("link", { name: "Request your institution report" })).toHaveAttribute(
      "href",
      "/reports?report=institution&src=data-sources#request",
    );
    expect(screen.getByRole("link", { name: DEMO_REQUEST_NAV.label })).toHaveAttribute("href", DEMO_REQUEST_NAV.href);
  });
});
