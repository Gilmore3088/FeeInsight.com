// @vitest-environment node
/** Real SQL and saved-report lifecycle. Explicit disposable loopback database only. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { getSql } from "@/lib/data-store/connection";
import { loadResearchInputs, getResearchTableProfiles } from "@/lib/data-store/research-database";
import { HOME, EXCLUDED } from "../../../tests/e2e/hamilton/fixtures";
import { seedResearchFixtures } from "../../../tests/e2e/hamilton/research-fixtures";
import { assembleResearchSnapshot, researchTitle } from "./assemble";
import { parseResearchRequest, RESEARCH_EDITION } from "./types";
import { renderResearchHtml } from "./presentation";
import { renderResearchPdf } from "./pdf";
import { runResearchRender, runResearchVerify } from "./run";
import { researchReadyToPublish } from "./manifest";

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("research database acceptance with real PostgreSQL", () => {
  const jobs: string[] = [];
  const bank = EXCLUDED.find(i => i.charter === "bank")!;
  let db: ReturnType<typeof getSql>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1"].includes(new URL(connection).hostname)
      || new URL(connection).pathname !== "/feeinsight_research_acceptance" || process.env.DATABASE_URL !== connection) {
      throw new Error("Research acceptance requires the dedicated local feeinsight_research_acceptance database.");
    }
    db = getSql();
    await seedResearchFixtures(db);
    await mkdir("test-results/research-acceptance", { recursive: true });
  }, 60_000);
  afterAll(async () => {
    if (db && process.env.RESEARCH_KEEP_FIXTURES !== "1") {
      await db`DELETE FROM report_jobs WHERE id::text=ANY(${jobs}::text[])`;
    }
    if (db) await db.end();
  });

  it("runs exact table profiles against the current schema", async () => {
    const profiles = await getResearchTableProfiles(db);
    expect(profiles.map(p => p.error)).toEqual([null, null, null, null, null]);
    await writeFile("test-results/research-acceptance/local-table-audit.json", JSON.stringify({ context: "Synthetic local acceptance data; not production coverage", profiles }, null, 2));
  });

  for (const scope of ["national", "bank", "credit_union"] as const) {
    it(`reads and produces the ${scope} pilot with actual SQL`, async () => {
      const request = parseResearchRequest({ scope: scope === "national" ? "national" : "footprint", cadence: "quarterly", institutionId: scope === "bank" ? bank.id : scope === "credit_union" ? HOME.id : null });
      const input = await loadResearchInputs(request, db);
      const snapshot = assembleResearchSnapshot(request, input, "local-acceptance-fixtures");
      expect(snapshot.cells.find(c => c.key === "population")?.value).toBe(400);
      expect(snapshot.cells.find(c => c.key === "bank_deposits")?.value).toBe(3_000_000);
      if (scope === "credit_union") expect(snapshot.footprint).toMatchObject({ branches: 2, counties: ["12009", "12095"], status: "available" });
      const title = `SYNTHETIC ACCEPTANCE FIXTURE: ${researchTitle(snapshot)}`;
      await writeFile(`test-results/research-acceptance/${scope}.html`, renderResearchHtml(snapshot, title));
      await writeFile(`test-results/research-acceptance/${scope}.json`, JSON.stringify({ context: "Synthetic local acceptance data; not for publication", snapshot }, null, 2));
      await writeFile(`test-results/research-acceptance/${scope}.pdf`, await renderResearchPdf(snapshot));
    });
  }

  it("renders, verifies, and completes a real report job without publishing it", async () => {
    const request = parseResearchRequest({ scope: "national", cadence: "quarterly" });
    const [job] = await db`INSERT INTO report_jobs (report_type, status, params)
      VALUES ('national_index','pending',${db.json(JSON.parse(JSON.stringify({ edition: RESEARCH_EDITION, research: request })))}) RETURNING id`;
    jobs.push(String(job.id));
    await runResearchRender(db, job.id, { load: r => loadResearchInputs(r, db), store: () => ({ put: async () => {} }) });
    await runResearchVerify(db, job.id);
    const [saved] = await db`SELECT status, data_manifest FROM report_jobs WHERE id=${job.id}`;
    expect(saved.status).toBe("complete");
    expect(researchReadyToPublish(saved.data_manifest)).toBe(true);
    const published = await db`SELECT id FROM published_reports WHERE job_id=${job.id}`;
    expect(published).toHaveLength(0);
  });
});
