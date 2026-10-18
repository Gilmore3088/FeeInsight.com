import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { makeStamp } from "@/lib/dataset-stamp";
import { DatasetNote } from "./DatasetNote";

const stamp = makeStamp({
  dataset: "published_fee_catalog",
  mode: "live",
  readAt: "2026-10-18T14:10:00Z",
  runId: null,
  newestRecordAt: null,
  methodVersion: 13,
  counting: "counted_once",
  filters: [{ key: "sourced", label: "Only fees traced to a stored copy of the institution's own fee schedule" }],
});
const texas = makeStamp({ ...stamp, filters: [...stamp.filters, { key: "peers:state:TX", label: "Institutions in TX" }] });

describe("DatasetNote (#1924 step 2)", () => {
  it("renders a quiet line that opens to the details and filters", () => {
    const html = renderToString(<DatasetNote figures={[{ label: "National medians", stamp }]} />);
    expect(html).toContain("<details");
    expect(html).toContain("<summary class=\"cursor-pointer\">Published fee schedules, read live 18 Oct 2026 14:10 UTC. Institutions sharing one fee schedule count once.</summary>");
    expect(html).toContain("Who is counted");
    expect(html).toContain("Only fees traced to a stored copy of the institution&#x27;s own fee schedule");
    expect(html).not.toContain("differ");
    expect(html).not.toContain("—");
  });

  it("says how two figures differ when their stamps do", () => {
    const html = renderToString(<DatasetNote figures={[{ label: "Texas", stamp: texas }, { label: "the U.S. reference", stamp }]} />);
    expect(html).toContain("How Texas and the U.S. reference differ");
    expect(html).toContain("Only Texas: Institutions in TX");
  });

  it("renders nothing without a stamp", () => {
    expect(renderToString(<DatasetNote figures={[null, undefined]} />)).toBe("");
  });
});
