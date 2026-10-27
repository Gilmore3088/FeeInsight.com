import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/report-engine/render-job", () => ({ getReportArtifactStore: vi.fn(), reportArtifactKey: (kind: string, id: string) => `reports/${kind}/${id}.html` }));
import { runResearchRender, runResearchVerify } from "./run";
import type { ResearchInputs } from "@/lib/data-store/research-database";
import type { sql } from "@/lib/data-store/connection";
import { researchReadyToPublish } from "./manifest";

const research = { scope: "national", cadence: "quarterly", modules: ["market"] };
const input: ResearchInputs = { capturedAt: "2026-10-26T00:00:00Z", institutions: [], footprint: null, branches: [], demographics: [{ geo_id: "county:01001", geo_name: "County", year: 2024, total_population: 42, median_household_income: 100 }], financials: [], fees: [], areas: [], audit: [] };

describe("research run ledger steps", () => {
  let job: { status: string; params: unknown; report_type: string; data_manifest: unknown };
  let db: typeof sql;
  let queries: string[];
  const put = vi.fn();
  beforeEach(() => {
    put.mockReset().mockResolvedValue(undefined);
    queries = [];
    job = { status: "pending", params: { edition: "research_v1", research }, report_type: "national_index", data_manifest: null };
    const tag = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      queries.push(text);
      if (text.includes("SELECT status")) return [structuredClone(job)];
      if (text.includes("status = 'assembling', error")) { if (!["pending", "assembling"].includes(job.status)) return []; job.status = "assembling"; return [{ id: "job" }]; }
      if (text.includes("SET status = 'rendering'")) { if (job.status !== "assembling") return []; job.status = "rendering"; job.data_manifest = values[1]; return [{ id: "job" }]; }
      if (text.includes("status = 'complete'")) { if (job.status !== "rendering" || JSON.stringify(job.data_manifest) !== JSON.stringify(values[2])) return []; job.status = "complete"; job.data_manifest = values[0]; return [{ id: "job" }]; }
      if (text.includes("status = 'failed'")) { if (!["cancelled", "cancel_requested"].includes(job.status)) job.status = "failed"; return []; }
      throw new Error(`Unexpected SQL ${text}`);
    });
    db = Object.assign(tag, { json: (value: unknown) => value }) as unknown as typeof sql;
  });
  it("stores evidence, replays it, and completes without publishing", async () => {
    await runResearchRender(db, "job", { load: vi.fn().mockResolvedValue(input), store: () => ({ put }) });
    expect(job.status).toBe("rendering"); expect(put).toHaveBeenCalledOnce();
    expect(researchReadyToPublish(job.data_manifest)).toBe(false);
    await runResearchVerify(db, "job");
    expect(job.status).toBe("complete"); expect(researchReadyToPublish(job.data_manifest)).toBe(true);
    expect(queries.every(query => !query.includes("published_reports"))).toBe(true);
  });
  it("preserves cancellation during artifact upload", async () => {
    put.mockImplementation(async () => { job.status = "cancel_requested"; });
    const result = await runResearchRender(db, "job", { load: vi.fn().mockResolvedValue(input), store: () => ({ put }) });
    expect(result.status).toBe("skipped"); expect(job.status).toBe("cancel_requested"); expect(job.data_manifest).toBeNull();
  });
  it("keeps query failures visible and marks the report failed", async () => {
    await expect(runResearchRender(db, "job", { load: vi.fn().mockRejectedValue(new Error("source read failed")), store: () => ({ put }) })).rejects.toThrow("source read failed");
    expect(job.status).toBe("failed"); expect(put).not.toHaveBeenCalled();
  });
  it("marks missing artifact configuration failed instead of stranding a pending job", async () => {
    await expect(runResearchRender(db, "job", { load: vi.fn(), store: () => null })).rejects.toThrow(/storage/);
    expect(job.status).toBe("failed");
  });
  it("can recover an interrupted assembly and skips an already stored artifact", async () => {
    job.status = "assembling";
    const deps = { load: vi.fn().mockResolvedValue(input), store: () => ({ put }) };
    await runResearchRender(db, "job", deps);
    expect(job.status).toBe("rendering");
    await runResearchRender(db, "job", deps);
    expect(put).toHaveBeenCalledOnce();
  });
  it("rejects altered frozen evidence", async () => {
    await runResearchRender(db, "job", { load: vi.fn().mockResolvedValue(input), store: () => ({ put }) });
    const manifest = job.data_manifest as { research_inputs: ResearchInputs };
    manifest.research_inputs.demographics[0].total_population = 999;
    await expect(runResearchVerify(db, "job")).rejects.toThrow(/did not reproduce/);
    expect(job.status).toBe("failed");
  });
});
