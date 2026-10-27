/** Synthetic browser → ledger → PostgreSQL → object storage → report acceptance. */
import { expect, test, type Page } from "playwright/test";
import { createServer, type Server } from "node:http";
import { FIXTURE_USERS, HOME, connectFixtureDb, type FixtureDb } from "./fixtures";
import { seedResearchFixtures } from "./research-fixtures";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
let db: FixtureDb;
let storage: Server;
let publicSlug = "";
let publicReportId = "";
const objects = new Map<string, Buffer>();

test.beforeAll(async () => {
  db = connectFixtureDb();
  await seedResearchFixtures(db);
  storage = createServer(async (request, response) => {
    const key = new URL(request.url!, "http://localhost").pathname;
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"research-fixture"' }); response.end(); return;
    }
    const value = objects.get(key);
    response.writeHead(value ? 200 : 404, { "Content-Type": "text/html" }); response.end(value);
  });
  await new Promise<void>(resolve => storage.listen(3320, "127.0.0.1", resolve));
});
test.afterAll(async () => {
  await db?.end();
  if (storage) await new Promise<void>((resolve, reject) => storage.close(error => error ? reject(error) : resolve()));
});

async function finishJob(admin: Page, jobId: string) {
  const [job] = await db`SELECT agent_run_id FROM report_jobs WHERE id=${jobId}`;
  expect(job.agent_run_id).toBeTruthy();
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await admin.request.post(`/api/admin/agents/runs/${job.agent_run_id}/execute`, { data: { maxSteps: 5 }, timeout: 120_000 });
    expect(response.status()).toBe(202);
    const [saved] = await db`SELECT status,error FROM report_jobs WHERE id=${jobId}`;
    if (saved.status === "complete") return;
    expect(saved.status, saved.error ?? "Research job failed").not.toBe("failed");
  }
  throw new Error("Research ledger did not complete within four bounded advances.");
}

test("operator prepares, reviews and publishes a synthetic national edition", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.admin.email, "/admin/hamilton/research-database");
  await page.goto("/admin/hamilton/research-database?profile=1");
  await expect(page.getByRole("heading", { name: "Research database", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare research report" }).click();
  await expect(page).toHaveURL(/research-database\/jobs\/[a-f0-9-]+/);
  const jobId = new URL(page.url()).pathname.split("/").at(-1)!;
  await finishJob(page, jobId);
  await page.reload();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  const preview = page.getByRole("link", { name: "Preview PDF" });
  const pdf = await page.request.get((await preview.getAttribute("href"))!);
  expect(pdf.status()).toBe(200); expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  const [published] = await db`SELECT p.slug, p.id, j.data_manifest FROM published_reports p JOIN report_jobs j ON j.id=p.job_id WHERE p.job_id=${jobId}`;
  expect(published.data_manifest.research_editorial_review.reviewerId).toBe(FIXTURE_USERS.admin.id);
  publicSlug = published.slug; publicReportId = published.id;
  await page.screenshot({ path: "test-results/research-acceptance/admin-review.png", fullPage: true });
});

test("anonymous readers can read and download the report and retain context at signup", async ({ page }) => {
  await page.goto(`/reports/${publicSlug}`);
  await expect(page.getByRole("heading", { name: "Market opportunity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Methodology and limitations", exact: true })).toBeVisible();
  const pdf = await page.request.get((await page.getByRole("link", { name: "Download PDF", exact: true }).getAttribute("href"))!);
  expect(pdf.status()).toBe(200); expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.screenshot({ path: "test-results/research-acceptance/public-report.png", fullPage: true });
  await page.getByRole("link", { name: "Analyze your institution" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  expect(decodeURIComponent(page.url())).toContain(publicReportId);
});

test("subscriber customizes a footprint, exports it, and another subscriber is refused", async ({ page, browser }) => {
  await signIn(page, FIXTURE_USERS.pro.email, `/pro/reports/research?instId=${HOME.id}&researchReport=${publicReportId}`);
  await page.goto(`/pro/reports/research?instId=${HOME.id}&researchReport=${publicReportId}`);
  await page.getByRole("button", { name: "Prepare my market report" }).click();
  await expect(page).toHaveURL(/research\?job=/);
  const jobId = new URL(page.url()).searchParams.get("job")!;
  const admin = await browser.newPage();
  await signIn(admin, FIXTURE_USERS.admin.email, "/admin/hamilton/research-database");
  await finishJob(admin, jobId); await admin.close();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Institution footprint", exact: true })).toBeVisible();
  const exported = await page.request.get(`/api/pro/research/${jobId}/export`);
  expect(exported.status()).toBe(200);
  const data = await exported.json();
  expect(data.footprint.counties).toEqual(["12009", "12095"]);
  expect(data.audit).toBeUndefined();
  const [saved] = await db`SELECT params FROM report_jobs WHERE id=${jobId}`;
  expect(saved.params.originReportId).toBe(publicReportId);
  await page.screenshot({ path: "test-results/research-acceptance/paid-report.png", fullPage: true });
  const other = await browser.newPage();
  await signIn(other, FIXTURE_USERS.proNoHome.email);
  expect((await other.request.get(`/api/pro/research/${jobId}/export`)).status()).toBe(404);
  expect((await other.request.get(`/api/pro/research/${jobId}/pdf`)).status()).toBe(404);
  await other.close();
});
