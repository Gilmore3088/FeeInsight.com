import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CohortStrip } from "./cohort-strip";
import type { CohortPoint, CohortStripData } from "./fee-share-cohort";

function point(id: number, name: string): CohortPoint {
  return { id, name, city: null, state: "FL", assets: 2e9, serviceCharges: 1e6, revenue: 2e7, sharePct: 5 };
}

const DATA: CohortStripData = {
  axisMax: 10,
  ticks: [0, 5, 10],
  counts: [1, 1],
  beyond: 0,
  subject: point(1, "Subject Bank"),
  nearest: [point(2, "Nearby Bank")],
  listed: 40,
  p25: 3,
  median: 5,
  p75: 7,
};

afterEach(() => vi.unstubAllGlobals());

describe("CohortStrip search", () => {
  it("ignores a stale search response that arrives after the current one", async () => {
    const pending = new Map<string, (members: CohortPoint[]) => void>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const q = new URL(url, "http://x").searchParams.get("q") ?? "";
        return new Promise((resolve) => {
          pending.set(q, (members) => resolve({ ok: true, json: async () => ({ total: members.length, members }) }));
        });
      }),
    );
    render(
      <CohortStrip institutionId={1} subjectName="Subject Bank" data={DATA} quarter="Q2 2026" sourceName="FDIC" measureName="Service charges" yearToDate={false} />,
    );
    const input = screen.getByLabelText(/Find a peer/);
    fireEvent.change(input, { target: { value: "ca" } });
    await waitFor(() => expect(pending.has("ca")).toBe(true));
    fireEvent.change(input, { target: { value: "cap" } });
    await waitFor(() => expect(pending.has("cap")).toBe(true));

    await act(async () => pending.get("cap")!([point(3, "Capital Bank")]));
    expect(await screen.findByText("Capital Bank")).toBeTruthy();
    await act(async () => pending.get("ca")!([point(4, "Cascade Bank")]));
    expect(screen.getByText("Capital Bank")).toBeTruthy();
    expect(screen.queryByText("Cascade Bank")).toBeNull();
    expect(screen.queryByText("No match.")).toBeNull();
  });
});

describe("subject colour", () => {
  it("draws the subject in ink, never the variance red or blue", () => {
    const css = fs.readFileSync(path.join(__dirname, "profile.css"), "utf8");
    const subject = [...css.matchAll(/--fi-subject:\s*([^;]+);/g)].map((m) => m[1]);
    expect(subject.length).toBeGreaterThan(0);
    for (const value of subject) expect(value).toMatch(/^var\(--fi-ink/);
    expect(css).not.toMatch(/2a6fc4|4d8fe0/);
    const { container } = render(
      <CohortStrip institutionId={1} subjectName="Subject Bank" data={DATA} quarter="Q2 2026" sourceName="FDIC" measureName="Service charges" yearToDate={false} />,
    );
    expect(container.querySelector('circle[fill="var(--fi-subject)"]')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/variance-(above|below)|fi-brick|2a6fc4/);
    // The median and a hovered bar are dark slate, so nothing else shares the subject's ink.
    expect(container.innerHTML).not.toMatch(/var\(--color-ink\)/);
  });
});
