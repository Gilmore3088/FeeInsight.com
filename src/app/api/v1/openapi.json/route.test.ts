import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("/api/v1/openapi.json", () => {
  it("keeps query parameters out of path keys", async () => {
    const spec = await (await GET()).json();
    const paths = Object.keys(spec.paths);
    expect(paths).toEqual(["/fees", "/index", "/institutions", "/revenue", "/fee-changes"]);
    const institutionParams = spec.paths["/institutions"].get.parameters.map(
      (p: { name?: string }) => p.name,
    );
    expect(institutionParams).toContain("id");
    const feeParams = spec.paths["/fees"].get.parameters.map((p: { name?: string }) => p.name);
    expect(feeParams).toContain("category");
  });
});
