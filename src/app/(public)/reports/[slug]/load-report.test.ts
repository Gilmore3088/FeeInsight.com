import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("@/lib/data-store/connection", () => ({ getSql: () => sql }));

import { loadPublicReport } from "./load-report";

describe("loadPublicReport (#1495)", () => {
  beforeEach(() => sql.mockReset());

  it("returns the public report, or null when the slug has none", async () => {
    sql.mockResolvedValueOnce([{ slug: "q3", title: "Q3" }]);
    await expect(loadPublicReport("q3")).resolves.toMatchObject({ slug: "q3" });
    sql.mockResolvedValueOnce([]);
    await expect(loadPublicReport("missing")).resolves.toBeNull();
  });

  it("throws on a database error, so a blip is never cached as a 404", async () => {
    sql.mockRejectedValueOnce(new Error("connection reset"));
    await expect(loadPublicReport("blip")).rejects.toThrow("connection reset");
  });

  it("is the one read the layout, the metadata and the page share", () => {
    for (const file of ["layout.tsx", "page.tsx"]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source, file).toContain("loadPublicReport(slug)");
      expect(source, file).not.toContain("getSql");
    }
  });
});
