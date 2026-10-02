import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

import { MAGELLAN_FETCH_STRATEGY, runMagellanFetch } from "./fetch";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("FROM institution_sources")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}

function asFetchDb(db: DbMock): NonNullable<Parameters<typeof runMagellanFetch>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runMagellanFetch>[0]["db"]>;
}

function response(body: string, contentType = "text/html", status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("Magellan agentic fetch", () => {
  it("fetches a source document and writes crawl result plus target health", async () => {
    const body = "monthly maintenance fee overdraft fee";
    const db = createDbMock([
      {
        id: 42,
        institution_name: "Test Bank",
        fee_schedule_url: "https://testbank.example/fees",
        asset_size: "1000000",
        last_crawl_at: null,
        consecutive_failures: 0,
      },
    ]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(body));

    const result = await runMagellanFetch({
      runId: 101,
      limit: 500,
      db: asFetchDb(db),
      fetchImpl,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      bytes: body.length,
      limit: 50,
      dryRun: false,
    });
    expect(result.results[0]).toMatchObject({
      institutionId: 42,
      outcome: "success",
      finalUrl: "https://testbank.example/fees",
      statusCode: 200,
      documentType: "html",
      contentHash: createHash("sha256").update(body).digest("hex"),
    });

    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("INSERT INTO source_documents");
    expect(sqlText).toContain("UPDATE institution_sources");
    expect(sqlText).toContain("last_success_at = NOW()");
  });

  it("keeps dry runs read-only while still reporting fetched documents", async () => {
    const db = createDbMock([
      {
        id: 43,
        institution_name: "Dry Run CU",
        fee_schedule_url: "https://dryrun.example/schedule-of-fees.pdf",
        asset_size: "1000",
        last_crawl_at: null,
        consecutive_failures: 0,
      },
    ]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response("%PDF", "application/pdf"));

    const result = await runMagellanFetch({
      runId: 102,
      dryRun: true,
      db: asFetchDb(db),
      fetchImpl,
    });

    expect(result.succeeded).toBe(1);
    expect(result.results[0].documentType).toBe("pdf");
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("records failed source fetches and increments target failure state", async () => {
    const db = createDbMock([
      {
        id: 44,
        institution_name: "Broken Bank",
        fee_schedule_url: "https://broken.example/fees",
        asset_size: "500",
        last_crawl_at: null,
        consecutive_failures: 2,
      },
    ]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response("missing", "text/html", 404));

    const result = await runMagellanFetch({
      runId: 103,
      db: asFetchDb(db),
      fetchImpl,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
    });
    expect(result.results[0]).toMatchObject({
      outcome: "failed",
      statusCode: 404,
      reason: "HTTP 404",
    });

    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("INSERT INTO source_documents");
    expect(sqlText).toContain("consecutive_failures = COALESCE(consecutive_failures, 0) + 1");
    expect(sqlText).not.toContain("agentic_fetch_failed");
    expect(JSON.stringify(db.mock.calls)).toContain("magellan_fetch_http_404");
  });

  it("rotates fetch work by retry window instead of immediately retrying failures", async () => {
    const db = createDbMock([]);
    const fetchImpl = vi.fn();

    await runMagellanFetch({
      runId: 104,
      db: asFetchDb(db),
      fetchImpl,
    });

    const sqlText = templateText(db.mock.calls[0][0]);
    expect(sqlText).not.toContain("OR consecutive_failures > 0");
    expect(sqlText).toContain("WHEN COALESCE(inst.consecutive_failures, 0) >= 3 THEN INTERVAL '7 days'");
    expect(sqlText).toContain("WHEN COALESCE(inst.consecutive_failures, 0) > 0 THEN INTERVAL '24 hours'");
    expect(sqlText).toContain("inst.last_crawl_at ASC NULLS FIRST");
    expect(sqlText).toContain("COALESCE(inst.consecutive_failures, 0) ASC");
  });

  it("filters fetch candidates by state lane and profile memory", async () => {
    const db = createDbMock([]);
    const fetchImpl = vi.fn();

    await runMagellanFetch({
      runId: 105,
      stateCode: "WA",
      db: asFetchDb(db),
      fetchImpl,
    });

    const sqlText = templateText(db.mock.calls[0][0]);
    expect(sqlText).toContain("upper(btrim(inst.state_code))");
    expect(sqlText).toContain("institution_source_profiles");
    expect(sqlText).toContain("profile.canonical_source_url IS NOT NULL");
    expect(sqlText).toContain("COALESCE(profile.read_strategy, '') <> 'manual_review'");
  });

  describe("with the learning core", () => {
    const body = "Schedule of fees: monthly maintenance fee $5";
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const candidate = {
      id: 45,
      institution_name: "Learning Bank",
      fee_schedule_url: "https://learning.example/fees",
      asset_size: "1000",
      last_crawl_at: "2026-09-01T00:00:00Z",
      consecutive_failures: 0,
      profile_last_source_hash: bodyHash,
      profile_last_document_id: 900,
    };

    function learningDb(previous: Record<string, unknown> | null): DbMock {
      return vi.fn((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("FROM institution_sources")) return Promise.resolve([candidate]);
        if (text.includes("FROM source_documents")) return Promise.resolve(previous ? [previous] : []);
        if (text.includes("INSERT INTO source_documents")) return Promise.resolve([{ id: 1001 }]);
        return Promise.resolve([]);
      });
    }

    function attemptValues(db: DbMock): unknown[][] {
      return db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
        .map((call) => call.slice(1));
    }

    it("records an unchanged attempt instead of a duplicate document when the hash matches", async () => {
      const db = learningDb({ id: 900, content_hash: bodyHash, etag: null, last_modified: null });
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(body));

      const result = await runMagellanFetch({ runId: 201, stepId: 7, db: asFetchDb(db), fetchImpl });

      expect(result).toMatchObject({ succeeded: 0, unchanged: 1, failed: 0, learning: true, outcomes: { unchanged: 1 } });
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).not.toContain("INSERT INTO source_documents");
      expect(sqlText).toContain("last_checked_at = NOW()");
      const [attempt] = attemptValues(db);
      expect(attempt).toEqual(expect.arrayContaining([45, 900, "fetch", MAGELLAN_FETCH_STRATEGY.strategy, bodyHash, "unchanged", 201, 7]));
    });

    it("sends validators and treats a 304 as unchanged", async () => {
      const db = learningDb({ id: 900, content_hash: bodyHash, etag: '"v1"', last_modified: "Tue, 01 Sep 2026 00:00:00 GMT" });
      const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 304 }));

      const result = await runMagellanFetch({ runId: 202, db: asFetchDb(db), fetchImpl });

      const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
      expect(headers["If-None-Match"]).toBe('"v1"');
      expect(headers["If-Modified-Since"]).toBe("Tue, 01 Sep 2026 00:00:00 GMT");
      expect(result).toMatchObject({ unchanged: 1, bytes: 0 });
      expect(result.results[0]).toMatchObject({ outcome: "unchanged", contentHash: bodyHash, previousDocumentId: 900 });
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).not.toContain("INSERT INTO source_documents");
    });

    it("inserts a new document with validators when the content changed", async () => {
      const db = learningDb({ id: 900, content_hash: "old-hash", etag: null, last_modified: null });
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        new Response("%PDF-1.7 new schedule", {
          status: 200,
          headers: { "content-type": "application/octet-stream", etag: '"v2"' },
        }),
      );

      const result = await runMagellanFetch({ runId: 203, db: asFetchDb(db), fetchImpl });

      expect(result).toMatchObject({ succeeded: 1, unchanged: 0, outcomes: { ok: 1 } });
      expect(result.results[0]).toMatchObject({ documentType: "pdf", etag: '"v2"' });
      const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO source_documents"));
      expect(templateText(insert?.[0])).toContain("etag, last_modified, last_checked_at");
      expect(insert).toEqual(expect.arrayContaining(['"v2"']));
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["fetch", "ok", 1001]));
    });

    it("records a typed outcome for a network timeout", async () => {
      const db = learningDb(null);
      const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      const fetchImpl = vi.fn().mockRejectedValueOnce(abort);

      const result = await runMagellanFetch({ runId: 204, db: asFetchDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ outcome: "failed", attemptOutcome: "timeout" });
      expect(JSON.stringify(db.mock.calls)).toContain("magellan_fetch_timeout");
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["fetch", "timeout"]));
    });
  });
});
