import { readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "@/lib/api-v1";
import { GET } from "./route";

const V1_DIR = join(process.cwd(), "src/app/api/v1");
const NOT_DATA_ROUTES = new Set(["mcp", "openapi.json"]);

describe("/api/v1/openapi.json", () => {
  it("keeps query parameters out of path keys", async () => {
    const spec = await (await GET()).json();
    const paths = Object.keys(spec.paths);
    expect(paths).toEqual(["/fees", "/index", "/institutions", "/revenue", "/fee-changes", "/branches", "/market", "/hamilton-context", "/peers", "/rate-fees"]);
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
    for (const [name, path] of Object.entries(spec.paths) as [string, { get: { responses: Record<string, unknown> } }][]) {
      if (name === "/hamilton-context") {
        expect(path.get.responses).not.toHaveProperty("304");
      } else {
        expect(path.get.responses).toHaveProperty("304");
      }
    }
  });

  it("documents private holder context with no query parameters and no sensitive account fields", async () => {
    const spec = await (await GET()).json();
    const context = spec.paths["/hamilton-context"].get;
    expect(context.parameters).toEqual([]);
    expect(context.responses["200"].headers["Cache-Control"].schema.enum).toEqual(["private, no-store"]);
    expect(context.responses["403"].$ref).toBe("#/components/responses/AccountContextRequired");
    expect(context.responses["503"].$ref).toBe("#/components/responses/ContextUnavailable");

    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile({
      ...context.responses["200"].content["application/json"].schema,
      components: spec.components,
    });
    const empty = { institution: null, institution_source: "none", peer_sets: [], active_peer_set_id: null, note: "No defaults saved.", attribution: { text: "Source: Bank Fee Index", url: "https://feeinsight.com" } };
    expect(validate(empty), ajv.errorsText(validate.errors)).toBe(true);
    const saved = {
      ...empty,
      institution: { id: 2466, name: "Gateway Bank" },
      institution_source: "manual",
      active_peer_set_id: 31,
      peer_sets: [{
        id: 31, name: "Selected workspace peers", scope: "workspace", workspace_institution_id: 2466,
        is_default: true, filters: { charter_type: "bank", asset_tiers: ["community_mid"], fed_districts: [9], states: ["MN"], institution_ids: [12, 48] },
      }],
    };
    expect(validate(saved), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate({ ...saved, institution_source: "account" })).toBe(true);
    expect(validate({ ...saved, active_peer_set_id: "31" })).toBe(false);
    expect(validate({ ...saved, peer_sets: [{ ...saved.peer_sets[0], filters: { states: "MN" } }] })).toBe(false);
    for (const field of ["user_id", "email", "billing"]) expect(validate({ ...saved, [field]: "private" })).toBe(false);
    expect(validate({ ...saved, peer_sets: [{ ...saved.peer_sets[0], created_by: 99 }] })).toBe(false);
  });

  it("documents optional peer defaults, explicit saved selection, and the source of each comparison", async () => {
    const spec = await (await GET()).json();
    const peers = spec.paths["/peers"].get;
    const parameters = Object.fromEntries(peers.parameters.map((parameter: { name: string }) => [parameter.name, parameter]));
    expect(parameters.institution_id.required).not.toBe(true);
    expect(parameters.saved_peer_set_id.schema).toMatchObject({ type: "integer", minimum: 1 });
    expect(parameters.use_saved_context.schema).toEqual({ type: "boolean", default: true });
    expect(peers.responses["200"].content["application/json"].schema.required).toContain("context");
    expect(peers.responses["403"].$ref).toBe("#/components/responses/AccountContextRequired");
    expect(peers.responses["404"].description).toContain("not authorized");

    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile({ ...spec.components.schemas.PeerComparisonContext });
    expect(validate({ institution_source: "saved", peer_source: "saved", saved_peer_set_id: 31, saved_peer_set_name: "Regional bank peers" })).toBe(true);
    expect(validate({ institution_source: "explicit", peer_source: "default", saved_peer_set_id: null, saved_peer_set_name: null })).toBe(true);
    expect(validate({ institution_source: "account", peer_source: "explicit", saved_peer_set_id: null, saved_peer_set_name: null })).toBe(true);
    expect(validate({ institution_source: "manual", peer_source: "saved", saved_peer_set_id: 31, saved_peer_set_name: "Regional bank peers" })).toBe(false);
    expect(validate({ institution_source: "saved", peer_source: "saved", saved_peer_set_id: "31", saved_peer_set_name: "Regional bank peers" })).toBe(false);
  });
});
