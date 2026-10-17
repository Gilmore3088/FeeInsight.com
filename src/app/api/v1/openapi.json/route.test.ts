import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "@/lib/api-v1";
import { GET } from "./route";

const V1_DIR = join(process.cwd(), "src/app/api/v1");
const NOT_DATA_ROUTES = new Set(["mcp", "openapi.json"]);

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

describe("/api/v1/openapi.json matches the routes", () => {
  it("documents every v1 data route directory", async () => {
    const spec = await (await GET()).json();
    const routeDirs = readdirSync(V1_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !NOT_DATA_ROUTES.has(entry.name))
      .map((entry) => `/${entry.name}`)
      .sort();

    expect(routeDirs.length).toBeGreaterThan(0);
    expect(Object.keys(spec.paths).sort()).toEqual(routeDirs);
  });

  it("lists exactly the error codes the routes can return", async () => {
    const spec = await (await GET()).json();
    const specCodes = [...spec.components.schemas.Error.properties.code.enum].sort();

    expect(specCodes).toEqual([...API_ERROR_CODES].sort());
  });

  it("documents the per-minute limit, Retry-After and 304s", async () => {
    const spec = await (await GET()).json();

    expect(spec.components.responses.RateLimited.headers).toHaveProperty("Retry-After");
    expect(spec["x-rateLimit"].description).toContain("60 calls a minute");
    for (const path of Object.values(spec.paths) as { get: { responses: Record<string, unknown> } }[]) {
      expect(path.get.responses).toHaveProperty("304");
    }
  });
});
