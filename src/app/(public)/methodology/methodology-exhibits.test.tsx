import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UNSTATED_AUDIENCE_FOOTNOTE } from "@/lib/fee-audience";
import { ComputeRules, Limits, MedianExhibit, NextAction, PipelineFlow } from "./methodology-exhibits";
import { computeRules, nextAction, pickExampleBenchmark, pipelineStages } from "./methodology-view";

describe("PipelineFlow", () => {
  it("draws every stage and only the live counts it was given", () => {
    render(<PipelineFlow stages={pipelineStages({ monitored: 1000, scheduleLinks: 600, institutions: null, observations: 4321 })} />);
    const steps = within(screen.getByRole("list", { name: "Pipeline steps" })).getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    expect(screen.getByText("1,000")).toBeInTheDocument();
    // The visible label is the term itself, so it is read once.
    expect(screen.getAllByText("institutions monitored")).toHaveLength(1);
    expect(screen.getByText("institutions monitored").tagName).toBe("DT");
    expect(screen.getByRole("img", { name: "60% of institutions monitored" })).toBeInTheDocument();
    expect(screen.getByText("4,321")).toBeInTheDocument();
    expect(screen.queryByText("institutions with published fees")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("MedianExhibit", () => {
  const base = {
    fee_category: "overdraft",
    institution_count: 40,
    total_observations: 60,
    min_amount: 0,
    max_amount: 40,
    avg_amount: 28,
    median_amount: 30,
    p25_amount: 25,
    p75_amount: 35,
    bank_count: 20,
    cu_count: 20,
    zero_count: 2,
    bank_median_amount: null,
    cu_median_amount: null,
  };

  it("labels the median and middle half for screen readers", () => {
    render(<MedianExhibit example={pickExampleBenchmark([base])!} freshnessLabel="Data refreshed Oct 15, 2026" />);
    expect(screen.getByRole("img", { name: "Middle half $25 to $35, median $30, on a scale from $0 to $50" })).toBeInTheDocument();
    expect(screen.getByText("$25 to $35")).toBeInTheDocument();
    expect(screen.queryByText(UNSTATED_AUDIENCE_FOOTNOTE)).not.toBeInTheDocument();
  });

  it("shows the asterisk footnote linked to #audience when an unstated row contributes", () => {
    render(
      <MedianExhibit
        example={pickExampleBenchmark([{ ...base, unstated_audience_institution_count: 4 }])!}
        freshnessLabel="Data refreshed Oct 15, 2026"
      />,
    );
    expect(screen.getByRole("link", { name: "How audience is decided" })).toHaveAttribute("href", "/methodology#audience");
  });
});

describe("ComputeRules", () => {
  it("anchors each rule and keeps the detail behind a disclosure", () => {
    const { container } = render(<ComputeRules rules={computeRules(false)} />);
    expect(container.querySelector("#audience")).not.toBeNull();
    expect(screen.getByText("Not live yet")).toBeInTheDocument();
    expect(container.querySelector("#audience details")).toHaveAttribute("open");
    expect(container.querySelector("#median details")).not.toHaveAttribute("open");
    expect(container.querySelectorAll("details").length).toBeGreaterThan(0);
  });
});

describe("Limits", () => {
  it("states that we give no pricing advice and that data can lag", () => {
    render(<Limits />);
    expect(screen.getByText("No pricing advice")).toBeInTheDocument();
    expect(screen.getByText("Data can lag")).toBeInTheDocument();
    expect(screen.getByText("Coverage is uneven")).toBeInTheDocument();
  });
});

describe("NextAction", () => {
  it("offers one primary action and the demo second", () => {
    render(<NextAction action={nextAction(false)} />);
    expect(screen.getByRole("link", { name: "Request your institution report" })).toHaveAttribute(
      "href",
      "/reports?report=institution&src=methodology#request",
    );
    expect(screen.getByRole("link", { name: "Or ask for a demo" })).toHaveAttribute("href", "/contact?source=demo");
    expect(screen.getByRole("link", { name: "Or look up your own bank" })).toHaveAttribute("href", "/institutions");
  });
});
