// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: null as { id: number; role: string } | null, row: null as Record<string, unknown> | null, queries: [] as string[] }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/data-store/connection", () => ({ getSql: () => async (strings: TemplateStringsArray) => { m.queries.push(strings.join("?")); return m.row ? [m.row] : []; } }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handle: unknown) => handle }));
vi.mock("./pdf", () => ({ renderResearchPdf: async () => Buffer.from("%PDF-test") }));
import { GET as exportData } from "@/app/api/pro/research/[id]/export/route";
import { GET as publicPdf } from "@/app/api/reports/research/[slug]/pdf/route";
import { assembleResearchSnapshot } from "./assemble";
import { parseResearchRequest } from "./types";

function readyManifest() {
  const input = { capturedAt: "2026-10-26T00:00:00Z", institutions: [], branches: [], footprint: null, audit: [], financials: [], fees: [], areas: [], demographics: [{ geo_id: "county:01001", geo_name: "County", year: 2024, total_population: 42, median_household_income: 100 }] };
  const snapshot = assembleResearchSnapshot(parseResearchRequest({ scope: "national", cadence: "quarterly", modules: ["market"] }), input);
  return { research_inputs: input, research_snapshot: snapshot, research_verification: { verified: true, kind: "frozen_input_replay", snapshotHash: snapshot.snapshotHash } };
}
const request = new Request("https://feeinsight.com");
const context = { params: Promise.resolve({ id: "job" }) };
beforeEach(() => { m.user = null; m.row = null; m.queries = []; });

describe("private research exports", () => {
  it("requires authentication before reading a job", async () => {
    expect((await exportData(request, context)).status).toBe(401); expect(m.queries).toHaveLength(0);
  });
  it("rejects another customer's report", async () => {
    m.user = { id: 2, role: "premium" }; m.row = { user_id: 1, status: "complete", data_manifest: readyManifest() };
    expect((await exportData(request, context)).status).toBe(404);
  });
  it("exports an owner's existing report without exposing raw input rows", async () => {
    m.user = { id: 1, role: "viewer" }; m.row = { user_id: 1, status: "complete", data_manifest: readyManifest() };
    const response = await exportData(request, context);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const json = await response.json(); expect(json.cells.length).toBeGreaterThan(0); expect(json.research_inputs).toBeUndefined(); expect(json.audit).toBeUndefined();
  });
  it("refuses incomplete or tampered artifacts", async () => {
    m.user = { id: 1, role: "premium" }; m.row = { user_id: 1, status: "rendering", data_manifest: readyManifest() };
    expect((await exportData(request, context)).status).toBe(409);
    m.row.status = "complete"; const manifest = readyManifest(); manifest.research_snapshot.cells[0].value = 999; m.row.data_manifest = manifest;
    expect((await exportData(request, context)).status).toBe(409);
  });
});
describe("public PDF access", () => {
  it("requires a public completed publication and verified frozen evidence", async () => {
    expect((await publicPdf(request, { params: Promise.resolve({ slug: "missing" }) })).status).toBe(404);
    m.row = { data_manifest: readyManifest() };
    const response = await publicPdf(request, { params: Promise.resolve({ slug: "published" }) });
    expect(response.status).toBe(200); expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(m.queries[0]).toContain("p.is_public = true"); expect(m.queries[0]).toContain("j.status = 'complete'");
  });
});
