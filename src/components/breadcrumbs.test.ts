import { describe, expect, it } from "vitest";
import { trailFor } from "./breadcrumbs";

describe("trailFor", () => {
  it("drops the dashboard link and hides a trail that is only the current page", () => {
    expect(trailFor([{ label: "Atlas", href: "/admin" }, { label: "Published Data" }])).toEqual([]);
    expect(trailFor([{ label: "Verify" }])).toEqual([]);
  });

  it("keeps parent links on deeper screens", () => {
    expect(
      trailFor([
        { label: "Dashboard", href: "/admin" },
        { label: "States", href: "/admin/states" },
        { label: "TX" },
      ]),
    ).toEqual([{ label: "States", href: "/admin/states" }, { label: "TX" }]);
  });
});
