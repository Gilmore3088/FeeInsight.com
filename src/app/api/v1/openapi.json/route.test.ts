import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("/api/v1/openapi.json", () => {
  it("keeps query parameters out of path keys", async () => {
    const spec = await (await GET()).json();
    const paths = Object.keys(spec.paths);
    expect(paths).toEqual(["/fees", "/index", "/institutions", "/revenue", "/fee-changes", "/branches", "/market"]);
    const institutionParams = spec.paths["/institutions"].get.parameters.map(
      (p: { name?: string }) => p.name,
    );
    expect(institutionParams).toContain("id");
    const feeParams = spec.paths["/fees"].get.parameters.map((p: { name?: string }) => p.name);
    expect(feeParams).toContain("category");
  });

  it("documents fee_name and its flag the same way on fees[] and rate_fees[] (#1583)", async () => {
    const spec = await (await GET()).json();
    const detail = spec.components.schemas.InstitutionDetail.properties;
    for (const list of [detail.fees, detail.rate_fees]) {
      const { fee_name, name_is_category_fallback } = list.items.properties;
      expect(fee_name.description).toContain("made complete");
      expect(name_is_category_fallback.description).toContain("or that name made complete");
      expect(name_is_category_fallback.description).not.toContain("own wording");
    }
  });
});
