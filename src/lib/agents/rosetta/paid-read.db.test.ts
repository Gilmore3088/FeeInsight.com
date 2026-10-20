/** @vitest-environment node */
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { sql as AppSql } from "@/lib/data-store/connection";

const state = vi.hoisted(() => ({ client: null as unknown as postgres.Sql<{ json: unknown; numeric: number; text: string }>, schema: "", allowed: true }));
vi.mock("@/lib/data-store/connection", async (original) => {
  const actual = await original<typeof import("@/lib/data-store/connection")>();
  const qualify = (text: string) => text.replace(/\bpublic\.(institution_sources|source_documents|agent_source_texts|institution_source_profiles|pipeline_attempts|pipeline_feedback|agent_runs|ai_api_usage_events|agent_source_text_witnesses)\b/g,
    (_match, table: string) => `"${state.schema}".${table}`);
  const tag = (...args: unknown[]) => {
    const parts = args[0] as TemplateStringsArray;
    return Reflect.apply(state.client, state.client, [Object.assign(parts.map(qualify), { raw: parts.raw.map(qualify) }), ...args.slice(1)]);
  };
  const sql = new Proxy(tag, { get(_target, key) {
    if (key === "unsafe") return (query: string, params?: unknown[]) => Reflect.apply(state.client.unsafe, state.client, [qualify(query), params]);
    const value = Reflect.get(state.client, key, state.client);
    return typeof value === "function" ? value.bind(state.client) : value;
  } }) as unknown as typeof AppSql;
  return { ...actual, sql };
});
vi.mock("@/lib/automation-control", () => ({
  assertAutomationEnabled: async () => ({ enabled: true }), findOpenProviderCreditFailure: async () => null,
  engageEmergencyStop: () => { throw new Error("Unexpected billing stop"); },
  EmergencyStopActiveError: class extends Error {}, PROVIDER_CREDIT_ERROR_MARKERS: ["credit balance is too low"],
}));
vi.mock("@/lib/api-hardening/budget", async (original) => ({
  ...await original<typeof import("@/lib/api-hardening/budget")>(),
  assertProviderBudgetAllowed: async () => ({ allowed: state.allowed, policyId: 1, reasonCode: "budget_monthly_exhausted", message: "Owned fixture cap" }),
}));

import { sql, JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { runRosettaPaidRead, PAID_READ_STRATEGY, ROSETTA_PAID_READ_VERSION } from "./paid-read";
import { hashText, recordReadResult, type ReadResult } from "./read";
import { incurredProviderUsageSql } from "@/lib/provider-usage-accounting";
import { normalizedWitnessSchemaReady } from "./normalized-witness";
import { tableRowsFromText, tableRowsPayload } from "./table-rows";

const url = process.env.E2E_DATABASE_URL;
const schema = `rosetta_policy_${randomBytes(8).toString("hex")}`;
const tables = ["institution_sources", "source_documents", "agent_source_texts", "institution_source_profiles",
  "pipeline_attempts", "pipeline_feedback", "agent_runs", "ai_api_usage_events"];
const text = "SCHEDULE OF FEES\nOverdraft fee | $35.00\nNSF fee | $35.00\nStop payment | $30.00";
const pdf = new TextEncoder().encode("%PDF-1.4 owned Rosetta SQL fixture");
const sourceHash = hashText(Buffer.from(pdf).toString());
const known = { input_tokens: 10, output_tokens: 20 };
// Exact main migration, scoped only to this suite's random schema. Production schema is unchanged.
const witnessMigration = readFileSync(new URL("../../../../supabase/migrations/20270110000067_normalized_source_text_witnesses.sql", import.meta.url), "utf8");

describe.skipIf(!url)("Rosetta paid policy on owned full-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Only an owned loopback E2E database is permitted");
    state.schema = schema;
    state.client = postgres(url, { max: 1, ssl: "require", prepare: false, connection: { search_path: `"${schema}",public` },
      types: { json: JSON_TEXT_PASSTHROUGH, numeric: NUMERIC_AS_NUMBER, text: TEXT_WITHOUT_NUL } });
    const [ready] = await state.client`SELECT to_regclass('public.pipeline_feedback') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_source_texts' AND column_name = 'table_rows') AS ready`;
    if (!ready?.ready) throw new Error("Load the current complete production-schema fixture first");
    await state.client.unsafe(`CREATE SCHEMA "${schema}"`);
    for (const table of tables) {
      await state.client.unsafe(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
      const defaults = await state.client`SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema}
        AND table_name = ${table} AND column_default LIKE 'nextval(%'`;
      for (const column of defaults) {
        await state.client.unsafe(`ALTER TABLE "${schema}".${table} ALTER COLUMN "${column.column_name}" DROP DEFAULT`);
        await state.client.unsafe(`ALTER TABLE "${schema}".${table} ALTER COLUMN "${column.column_name}" ADD GENERATED BY DEFAULT AS IDENTITY`);
      }
    }
  });
  beforeEach(async () => {
    state.allowed = true;
    vi.stubEnv("PIPELINE_PAID_READ_MODEL", "claude-sonnet-5-5");
    await state.client.unsafe(`TRUNCATE ${tables.map((name) => `"${schema}".${name}`).join(", ")} RESTART IDENTITY`);
    await sql`INSERT INTO agent_runs (id, agent_name, run_kind) VALUES (900, 'rosetta', 'workflow')`;
  });
  afterEach(async () => {
    const [capability] = await state.client`SELECT to_regclass(${`${schema}.agent_source_text_witnesses`}) AS relation`;
    if (capability?.relation) {
      // Fixture-owner DDL only. The main migration's normal-DML immutability guard stays intact.
      await state.client.unsafe(`DROP TABLE "${schema}".agent_source_text_witnesses CASCADE`);
      await state.client.unsafe(`DROP FUNCTION IF EXISTS "${schema}".reject_normalized_witness_mutation()`);
    }
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (state.client) { await state.client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await state.client.end(); }
  });

  async function seed(prior?: string) {
    const [inst] = await sql`INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
      VALUES ('Owned Rosetta Policy Bank', 'bank', 'ZX', 'e2e', 'https://fixture.invalid/fees.pdf') RETURNING id`;
    const [doc] = await sql`INSERT INTO source_documents (institution_id, status, document_url, content_hash, content_type)
      VALUES (${inst.id}, 'success', 'https://fixture.invalid/fees.pdf', ${sourceHash}, 'application/pdf') RETURNING id`;
    const [artifact] = await sql`INSERT INTO agent_source_texts (institution_id, source_document_id, status, document_type, reader, source_hash, normalized_text, text_hash, char_count)
      VALUES (${inst.id}, ${doc.id}, ${prior ? "completed" : "needs_ocr"}, 'pdf', 'read.pdf_layout', ${sourceHash}, ${prior ?? null}, ${prior ? hashText(prior) : null}, ${prior?.length ?? 0}) RETURNING id`;
    await sql`INSERT INTO institution_source_profiles (institution_id, state_code, canonical_source_url, last_source_hash, last_successful_text_id)
      VALUES (${inst.id}, 'ZX', 'https://fixture.invalid/fees.pdf', ${sourceHash}, ${prior ? artifact.id : null})`;
    await sql`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome)
      VALUES (${inst.id}, ${doc.id}, 'read', 'read.pdf_layout', 3, ${sourceHash}, ${prior ? "ok" : "scanned_pdf"})`;
    if (prior) await sql`INSERT INTO pipeline_feedback (institution_id, source_document_id, about_stage, check_name, signal, kind, reported_by, dedupe_key, evidence)
      VALUES (${inst.id}, ${doc.id}, 'read', 'rosetta.text_survival', 'wrong', 'text_lost_fees', 'rosetta', ${`fixture:${doc.id}`}, ${JSON.stringify({ text_hash: hashText(prior) })}::jsonb)`;
    return { institution: Number(inst.id), document: Number(doc.id), artifact: Number(artifact.id) };
  }
  async function enableWitnessCapability() {
    await state.client.unsafe(witnessMigration.replace(/\bpublic\./g, `"${schema}".`));
    expect(await normalizedWitnessSchemaReady(sql)).toBe(true);
  }
  async function run(reason: unknown = "end_turn", usage: unknown = known, output = text) {
    const create = vi.fn(async () => ({ content: [{ type: "text", text: output }], stop_reason: reason, usage }) as never);
    const result = await runRosettaPaidRead({ db: sql, runId: 900, stepId: 4, create, stateCode: "ZX",
      fetchImpl: async () => new Response(pdf, { headers: { "content-type": "application/pdf" } }), pageCounter: async () => 2 });
    return { result, create };
  }

  it.each(["http", "vault", "malformed"])("keeps %s identity failure outside paid settlement and all artifact/profile/witness writes", async (kind) => {
    const selected = await seed(`${text}\nWire transfer fee | $25.00`);
    if (kind === "malformed") {
      await sql`UPDATE source_documents SET content_hash='invalid-selected-hash' WHERE id=${selected.document}`;
      await sql`UPDATE agent_source_texts SET source_hash='invalid-selected-hash' WHERE id=${selected.artifact}`;
      await sql`UPDATE pipeline_attempts SET input_fingerprint='invalid-selected-hash' WHERE source_document_id=${selected.document}`;
    }
    if (kind === "vault") await sql`UPDATE source_documents SET document_r2_key=${`${sourceHash.slice(0, 2)}/${sourceHash}`} WHERE id=${selected.document}`;
    await enableWitnessCapability();
    const [before] = await sql`SELECT * FROM agent_source_texts WHERE id=${selected.artifact}`;
    const [profile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id=${selected.institution}`;
    const changed = new TextEncoder().encode("%PDF-1.4 changed after capture");
    const fetch = vi.fn(async () => new Response(changed, { headers: { "content-type": "application/pdf" } }));
    const vaultRead = vi.fn(async () => changed);
    const create = vi.fn(); const pageCounter = vi.fn(async () => 2);
    const result = await runRosettaPaidRead({ db: sql, runId: 900, stepId: 4, create, stateCode: "ZX", fetchImpl: fetch, pageCounter,
      vault: { configured: kind === "vault", read: vaultRead,
        store: async () => { throw new Error("No vault write"); }, presign: async () => { throw new Error("No presign"); } } });
    expect(result).toMatchObject({ selected: 1, processed: 1, failed: 1, succeeded: 0, costMicrousd: 0, unknownCostResponses: 0 });
    expect(result.results[0]).toMatchObject({ outcome: "evidence_mismatch", response_received: false });
    expect(create).not.toHaveBeenCalled(); expect(pageCounter).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(kind === "http" ? 1 : 0);
    expect(vaultRead).toHaveBeenCalledTimes(kind === "vault" ? 1 : 0);
    expect((await sql`SELECT * FROM agent_source_texts WHERE id=${selected.artifact}`)[0]).toEqual(before);
    expect((await sql`SELECT * FROM institution_source_profiles WHERE institution_id=${selected.institution}`)[0]).toEqual(profile);
    expect(await sql`SELECT * FROM agent_source_text_witnesses`).toHaveLength(0);
    expect(await sql`SELECT * FROM ai_api_usage_events`).toHaveLength(0);
    expect(await sql`SELECT * FROM pipeline_attempts WHERE strategy=${PAID_READ_STRATEGY}`).toHaveLength(0);
    const [access] = await sql`SELECT outcome, detail FROM pipeline_attempts WHERE strategy='read.document_access'`;
    expect(access).toMatchObject({ outcome: "evidence_mismatch", detail: { paid_preflight: true, response_received: false,
      primary_byte_identity: { status: kind === "malformed" ? "invalid_selected_hash" : "mismatch" } } });
    const dry = await runRosettaPaidRead({ db: sql, runId: 900, stateCode: "ZX", dryRun: true });
    expect(dry.selected).toBe(1); // The access failure did not become a settled paid attempt.
  });

  it("does not select an unbound legacy scan for paid work through the actual SQL join", async () => {
    const selected = await seed();
    await sql`UPDATE source_documents SET content_hash=NULL WHERE id=${selected.document}`;
    await sql`UPDATE agent_source_texts SET source_hash=NULL WHERE id=${selected.artifact}`;
    expect(await sql`SELECT id FROM agent_source_texts WHERE id=${selected.artifact} AND source_hash IS NULL`).toHaveLength(1);
    const { result, create } = await run();
    expect(result).toMatchObject({ selected: 0, processed: 0, unknownCostResponses: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(await sql`SELECT * FROM ai_api_usage_events`).toHaveLength(0);
    expect(await sql`SELECT * FROM pipeline_attempts WHERE strategy=${PAID_READ_STRATEGY}`).toHaveLength(0);
  });

  it("accepts matching vault bytes without HTTP and retains normal paid accounting", async () => {
    const selected = await seed();
    await sql`UPDATE source_documents SET document_r2_key=${`${sourceHash.slice(0, 2)}/${sourceHash}`} WHERE id=${selected.document}`;
    const create = vi.fn(async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: known }) as never);
    const fetch = vi.fn(); const read = vi.fn(async () => pdf);
    const result = await runRosettaPaidRead({ db: sql, runId: 900, stepId: 4, create, stateCode: "ZX", fetchImpl: fetch, pageCounter: async () => 2,
      vault: { configured: true, read, store: async () => { throw new Error("No vault write"); }, presign: async () => { throw new Error("No presign"); } } });
    expect(result).toMatchObject({ succeeded: 1, costMicrousd: 220 });
    expect(create).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    expect((await sql`SELECT source_hash FROM agent_source_texts WHERE id=${selected.artifact}`)[0].source_hash).toBe(sourceHash);
    expect(await sql`SELECT * FROM ai_api_usage_events`).toHaveLength(1);
  });

  it("allows a legitimate later captured document after a zero-call mismatch", async () => {
    const selected = await seed();
    const changed = new TextEncoder().encode("%PDF-1.4 legitimate new captured bytes");
    const changedHash = hashText(Buffer.from(changed).toString());
    const create = vi.fn(async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: known }) as never);
    const options = { db: sql, runId: 900, stepId: 4, create, stateCode: "ZX", limit: 1,
      fetchImpl: async () => new Response(changed, { headers: { "content-type": "application/pdf" } }), pageCounter: async () => 2 };
    expect(await runRosettaPaidRead(options)).toMatchObject({ failed: 1, succeeded: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(await sql`SELECT * FROM ai_api_usage_events`).toHaveLength(0);
    expect(await sql`SELECT * FROM pipeline_attempts WHERE strategy=${PAID_READ_STRATEGY}`).toHaveLength(0);
    const [next] = await sql`INSERT INTO source_documents (institution_id, status, document_url, content_hash, content_type)
      VALUES (${selected.institution}, 'success', 'https://fixture.invalid/fees.pdf', ${changedHash}, 'application/pdf') RETURNING id`;
    await sql`INSERT INTO agent_source_texts (institution_id, source_document_id, status, document_type, reader, source_hash)
      VALUES (${selected.institution}, ${next.id}, 'needs_ocr', 'pdf', 'read.pdf_layout', ${changedHash})`;
    await sql`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome)
      VALUES (${selected.institution}, ${next.id}, 'read', 'read.pdf_layout', 3, ${changedHash}, 'scanned_pdf')`;
    const result = await runRosettaPaidRead(options);
    expect(result).toMatchObject({ selected: 1, succeeded: 1, failed: 0, costMicrousd: 220 });
    expect(result.results[0].source_document_id).toBe(Number(next.id));
    expect(create).toHaveBeenCalledTimes(1);
    expect(await sql`SELECT * FROM ai_api_usage_events`).toHaveLength(1);
    const paid = await sql`SELECT input_fingerprint, source_document_id FROM pipeline_attempts WHERE strategy=${PAID_READ_STRATEGY}`;
    expect(paid).toHaveLength(1); expect(paid[0].input_fingerprint).toBe(changedHash);
    expect(Number(paid[0].source_document_id)).toBe(Number(next.id));
  });

  it.each(["end_turn", "max_tokens", "model_context_window_exceeded"])("stores usable %s with actual text/table/profile and receipt lineage", async (reason) => {
    const selected = await seed(); const { result, create } = await run(reason);
    expect(result).toMatchObject({ selected: 1, succeeded: 1, failed: 0, costMicrousd: 220, unknownCostResponses: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    const [stored] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    expect(stored).toMatchObject({ status: "completed", normalized_text: text, text_hash: hashText(text), source_hash: sourceHash, reader: PAID_READ_STRATEGY, agent_run_id: 900 });
    expect(stored.table_rows.rows).toHaveLength(3);
    const [profile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    expect(Number(profile.last_successful_text_id)).toBe(selected.artifact);
    const [attempt] = await sql`SELECT * FROM pipeline_attempts WHERE strategy = ${PAID_READ_STRATEGY}`;
    expect(attempt).toMatchObject({ strategy_version: ROSETTA_PAID_READ_VERSION, input_fingerprint: sourceHash,
      outcome: reason === "end_turn" ? "ok" : "ok_partial",
      detail: { produced_text_hash: hashText(text), retained_text_hash: hashText(text), selected_source_hash: sourceHash, truncated: reason !== "end_turn" } });
    expect(Number(attempt.source_document_id)).toBe(selected.document);
    expect(Number(attempt.agent_run_id)).toBe(900); expect(Number(attempt.agent_run_step_id)).toBe(4);
    const [event] = await sql`SELECT status, estimated_cost_microusd, metadata FROM ai_api_usage_events`;
    expect(Number(event.estimated_cost_microusd)).toBe(220);
    expect(event.metadata).toMatchObject({ source_hash: sourceHash, source_document_id: selected.document, step_id: 4, response_complete: reason === "end_turn" });
  });

  it.each([
    { label: "missing", usage: undefined, model: "claude-sonnet-5-5", cost: null, observation: "unknown" },
    { label: "malformed", usage: { input_tokens: "10", output_tokens: -1 }, model: "claude-sonnet-5-5", cost: null, observation: "unknown" },
    { label: "zero", usage: { input_tokens: 0, output_tokens: 0 }, model: "claude-sonnet-5-5", cost: 0, observation: "observed" },
    { label: "unpriced", usage: known, model: "owned-unpriced-model", cost: null, observation: "observed" },
  ])("stores accepted $label cost honestly; unknown placeholders never lower learned paid mean", async (fixture) => {
    const selected = await seed(); vi.stubEnv("PIPELINE_PAID_READ_MODEL", fixture.model);
    const key = `read:${PAID_READ_STRATEGY}@${ROSETTA_PAID_READ_VERSION}`;
    const priorStat = { stage: "read", strategy: PAID_READ_STRATEGY, version: ROSETTA_PAID_READ_VERSION,
      attempts: 2, successes: 2, meanYield: 78, meanCostMicrousd: 111, lastOutcome: "ok", lastAt: "2026-10-18T00:00:00.000Z", recentYields: [78, 78] };
    if (fixture.cost === null) await sql`UPDATE institution_source_profiles
      SET strategy_stats = ${JSON.stringify({ [key]: priorStat })}::jsonb, cost_to_date_microusd = 222
      WHERE institution_id = ${selected.institution}`;
    // Explicit undefined must reach the response rather than the helper's ordinary-usage default.
    const create = vi.fn(async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: fixture.usage }) as never);
    const result = await runRosettaPaidRead({ db: sql, runId: 900, stepId: 4, create, stateCode: "ZX",
      fetchImpl: async () => new Response(pdf, { headers: { "content-type": "application/pdf" } }), pageCounter: async () => 2 });
    expect(result).toMatchObject({ succeeded: 1, costMicrousd: fixture.cost ?? 0, unknownCostResponses: fixture.cost === null ? 1 : 0 });
    const [event] = await sql`SELECT estimated_cost_microusd, metadata FROM ai_api_usage_events`;
    expect(event.estimated_cost_microusd === null ? null : Number(event.estimated_cost_microusd)).toBe(fixture.cost);
    expect(event.metadata).toMatchObject({ usage_observation: fixture.observation, token_counts_are_placeholders: fixture.observation === "unknown" });
    const [attempt] = await sql`SELECT cost_microusd, detail FROM pipeline_attempts WHERE strategy = ${PAID_READ_STRATEGY}`;
    expect(Number(attempt.cost_microusd)).toBe(fixture.cost ?? 0); expect(attempt.detail.cost_is_placeholder).toBe(fixture.cost === null);
    const [profile] = await sql`SELECT strategy_stats, cost_to_date_microusd FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const paidStat = profile.strategy_stats[key];
    if (fixture.cost === null) {
      expect(paidStat).toEqual(priorStat); expect(Number(profile.cost_to_date_microusd)).toBe(222);
    } else expect(paidStat.meanCostMicrousd).toBe(0);
    const [runRow] = await sql`SELECT actual_provider_calls, actual_estimated_cost_microusd FROM agent_runs WHERE id = 900`;
    expect(runRow.actual_provider_calls).toBe(1); expect(Number(runRow.actual_estimated_cost_microusd)).toBe(0);
  });

  it.each(["refusal", "pause_turn", "tool_use", "stop_sequence", null, "future_reason"])("settles rejected %s without text/profile success, Magellan handback or another paid call", async (reason) => {
    const prior = `${text}\nWire transfer fee | $25.00`; const selected = await seed(prior);
    const [before] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const [profileBefore] = await sql`SELECT canonical_source_url, last_source_hash, last_successful_text_id, last_success_at, last_failure_at FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const { result, create } = await run(reason);
    expect(result).toMatchObject({ failed: 1, succeeded: 0, costMicrousd: 220, unknownCostResponses: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect((await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(before);
    expect((await sql`SELECT canonical_source_url, last_source_hash, last_successful_text_id, last_success_at, last_failure_at FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(profileBefore);
    expect((await sql`SELECT fee_schedule_url FROM institution_sources WHERE id = ${selected.institution}`)[0].fee_schedule_url).toBe("https://fixture.invalid/fees.pdf");
    const attempts = await sql`SELECT outcome, detail FROM pipeline_attempts WHERE strategy = ${PAID_READ_STRATEGY}`;
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ outcome: "rejected", detail: { retained_text_hash: hashText(prior), produced_text_hash: hashText(text) } });
    expect(await sql`SELECT * FROM pipeline_attempts WHERE strategy IN ('read.page_check', 'read.table_rows')`).toHaveLength(0);
    const [event] = await sql`SELECT status, estimated_cost_microusd FROM ai_api_usage_events WHERE ${incurredProviderUsageSql(sql)}`;
    expect(event.status).toBe("failed"); expect(Number(event.estimated_cost_microusd)).toBe(220);
    const next = await run(); expect(next.result.selected).toBe(0); expect(next.create).not.toHaveBeenCalled();
  });

  it("keeps a better earlier text distinct from a produced partial, with unknown-cost attempt settled", async () => {
    const prior = `${text}\nWire transfer fee | $25.00`; const selected = await seed(prior);
    const [before] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const { result } = await run("model_context_window_exceeded", { input_tokens: "bad", output_tokens: 20 });
    expect(result).toMatchObject({ succeeded: 1, unknownCostResponses: 1 });
    expect(result.results[0]).toMatchObject({ outcome: "low_yield", produced_text_hash: hashText(text), retained_text_hash: hashText(prior), cost_microusd: null });
    expect((await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(before);
    const [attempt] = await sql`SELECT outcome, detail FROM pipeline_attempts WHERE strategy = ${PAID_READ_STRATEGY}`;
    expect(attempt).toMatchObject({ outcome: "low_yield", detail: { truncated: true, kept_earlier_text: true, cost_is_placeholder: true } });
    expect((await run()).result.selected).toBe(0);
  });

  it("records rejected unknown usage once without incurred spend, while a pre-call denial is not a returned unknown response", async () => {
    await seed(); const unknown = await run("refusal", { input_tokens: "bad", output_tokens: 20 });
    expect(unknown.result).toMatchObject({ failed: 1, unknownCostResponses: 1 });
    const [event] = await sql`SELECT status, estimated_cost_microusd, metadata FROM ai_api_usage_events`;
    expect(event).toMatchObject({ status: "failed", estimated_cost_microusd: null, metadata: { usage_observation: "unknown", token_counts_are_placeholders: true } });
    expect(await sql`SELECT * FROM ai_api_usage_events WHERE ${incurredProviderUsageSql(sql)}`).toHaveLength(0);
    expect((await sql`SELECT actual_provider_calls FROM agent_runs WHERE id = 900`)[0].actual_provider_calls).toBe(0);
    await sql`DELETE FROM pipeline_attempts WHERE strategy = ${PAID_READ_STRATEGY}`; state.allowed = false;
    const denied = await run(); expect(denied.result).toMatchObject({ processed: 0, budgetStopped: true, unknownCostResponses: 0 });
    expect(denied.create).not.toHaveBeenCalled();
    expect(await sql`SELECT * FROM pipeline_attempts WHERE strategy = ${PAID_READ_STRATEGY}`).toHaveLength(0);
  });

  it.each([false, true].flatMap((ready) => [
    { label: "known", usage: known, cost: 220, observation: "observed" },
    { label: "unknown", usage: { input_tokens: "invalid", output_tokens: 20 }, cost: null, observation: "unknown" },
  ].map((fixture) => ({ ...fixture, ready }))))("retains a committed $label provider receipt when the first text write fails (witness ready=$ready)", async (fixture) => {
    if (fixture.ready) await enableWitnessCapability();
    else expect(await normalizedWitnessSchemaReady(sql)).toBe(false);
    const selected = await seed(text);
    const [beforeArtifact] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const [beforeProfile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const create = vi.fn(async () => ({ content: [{ type: "text", text: `${text}\nWire transfer fee | $25.00` }],
      stop_reason: "end_turn", usage: fixture.usage }) as never);
    // Provider steps use autocommit statements. Fail the first artifact statement,
    // after the real tracker has already committed its independent usage receipt.
    await state.client.unsafe(`CREATE FUNCTION "${schema}".fail_paid_text_write() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned text persistence failure' USING ERRCODE = 'P0001'; END $$`);
    try {
      await state.client.unsafe(`CREATE TRIGGER fail_paid_text_write BEFORE INSERT ON "${schema}".agent_source_texts
        FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_paid_text_write()`);
      await expect(runRosettaPaidRead({ db: sql, runId: 900, stepId: 4, create, stateCode: "ZX",
        fetchImpl: async () => new Response(pdf, { headers: { "content-type": "application/pdf" } }), pageCounter: async () => 2 }))
        .rejects.toMatchObject({ code: "P0001", message: "owned text persistence failure" });
    } finally {
      await state.client.unsafe(`DROP TRIGGER IF EXISTS fail_paid_text_write ON "${schema}".agent_source_texts`);
      await state.client.unsafe(`DROP FUNCTION "${schema}".fail_paid_text_write()`);
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect((await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(beforeArtifact);
    expect((await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(beforeProfile);
    const events = await sql`SELECT status, estimated_cost_microusd, metadata FROM ai_api_usage_events`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "completed", metadata: { usage_observation: fixture.observation,
      token_counts_are_placeholders: fixture.observation === "unknown", source_document_id: selected.document } });
    expect(events[0].estimated_cost_microusd === null ? null : Number(events[0].estimated_cost_microusd)).toBe(fixture.cost);
    const [runRow] = await sql`SELECT actual_provider_calls, actual_estimated_cost_microusd FROM agent_runs WHERE id = 900`;
    expect(runRow.actual_provider_calls).toBe(1); expect(Number(runRow.actual_estimated_cost_microusd)).toBe(fixture.cost ?? 0);
    expect(await sql`SELECT * FROM pipeline_attempts WHERE strategy IN (${PAID_READ_STRATEGY}, 'read.page_check', 'read.table_rows')`).toHaveLength(0);
    if (fixture.ready) expect(await sql`SELECT * FROM agent_source_text_witnesses`).toHaveLength(0);
    // The rejected promise supplies no normal paid result/summary to the caller.
    // A later selection may still be due: this is not durable atomic settlement.
    const laterCreate = vi.fn(); const laterFetch = vi.fn();
    const later = await runRosettaPaidRead({ db: sql, runId: 900, stateCode: "ZX", dryRun: true,
      create: laterCreate, fetchImpl: laterFetch });
    expect(later).toMatchObject({ selected: 1, processed: 0, dryRun: true });
    expect(laterCreate).not.toHaveBeenCalled(); expect(laterFetch).not.toHaveBeenCalled();
  });

  it.each(["table_rows", "profile"].flatMap((phase) => [
    { label: "known", usage: known, cost: 220, observation: "observed" },
    { label: "unknown", usage: { input_tokens: "invalid", output_tokens: 20 }, cost: null, observation: "unknown" },
  ].map((fixture) => ({ ...fixture, phase }))))("rolls back later $phase failure without witness schema and preserves the $label returned receipt", async (fixture) => {
    expect(await normalizedWitnessSchemaReady(sql)).toBe(false);
    const selected = await seed(text);
    const priorRows = tableRowsPayload(tableRowsFromText(text, "pdf_layout"));
    await sql`UPDATE agent_source_texts SET table_rows = ${JSON.stringify(priorRows)}::jsonb,
      document_kind = 'fee_schedule', document_kind_version = 1 WHERE id = ${selected.artifact}`;
    const [beforeArtifact] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const [beforeProfile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const improved = `${text}\nWire transfer fee | $25.00`;
    const create = vi.fn(async () => ({ content: [{ type: "text", text: improved }],
      stop_reason: "end_turn", usage: fixture.usage }) as never);
    const target = fixture.phase === "table_rows" ? "agent_source_texts" : "institution_source_profiles";
    const event = fixture.phase === "table_rows" ? "UPDATE OF table_rows" : "INSERT OR UPDATE";
    const error = `owned later ${fixture.phase} persistence failure`;
    // The failing statement sees the prior text UPSERT; the profile seam also sees new rows.
    await state.client.unsafe(`CREATE FUNCTION "${schema}".fail_paid_later_write() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF (SELECT text_hash FROM "${schema}".agent_source_texts WHERE id = ${selected.artifact})
          IS DISTINCT FROM '${hashText(improved)}' THEN
          RAISE EXCEPTION 'owned later-write text precondition not reached';
        END IF;
        ${fixture.phase === "profile" ? `IF COALESCE((SELECT jsonb_array_length(table_rows->'rows')
          FROM "${schema}".agent_source_texts WHERE id = ${selected.artifact}), -1) <> 4 THEN
          RAISE EXCEPTION 'owned later-write table precondition not reached';
        END IF;` : ""}
        RAISE EXCEPTION '${error}' USING ERRCODE = 'P0001';
      END $fn$`);
    try {
      await state.client.unsafe(`CREATE TRIGGER fail_paid_later_write BEFORE ${event} ON "${schema}".${target}
        FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_paid_later_write()`);
      await expect(runRosettaPaidRead({ db: sql, runId: 900, stepId: 4, create, stateCode: "ZX",
        fetchImpl: async () => new Response(pdf, { headers: { "content-type": "application/pdf" } }), pageCounter: async () => 2 }))
        .rejects.toMatchObject({ code: "P0001", message: error });
    } finally {
      await state.client.unsafe(`DROP TRIGGER IF EXISTS fail_paid_later_write ON "${schema}".${target}`);
      await state.client.unsafe(`DROP FUNCTION "${schema}".fail_paid_later_write()`);
    }
    expect(create).toHaveBeenCalledTimes(1);
    const events = await sql`SELECT status, estimated_cost_microusd, metadata FROM ai_api_usage_events`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "completed", metadata: {
      usage_observation: fixture.observation, source_document_id: selected.document,
      token_counts_are_placeholders: fixture.observation === "unknown",
    } });
    expect(events[0].estimated_cost_microusd === null ? null : Number(events[0].estimated_cost_microusd)).toBe(fixture.cost);
    const [runRow] = await sql`SELECT actual_provider_calls, actual_estimated_cost_microusd FROM agent_runs WHERE id = 900`;
    expect(runRow.actual_provider_calls).toBe(1);
    expect(Number(runRow.actual_estimated_cost_microusd)).toBe(fixture.cost ?? 0);
    expect(await sql`SELECT * FROM pipeline_attempts WHERE strategy IN (${PAID_READ_STRATEGY}, 'read.page_check', 'read.table_rows')`).toHaveLength(0);
    const [afterArtifact] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    expect(afterArtifact.normalized_text).toBe(text);
    expect(afterArtifact).toEqual(beforeArtifact);
    expect((await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(beforeProfile);
  });

  // Preserve real begin/savepoint primitives while keeping the capability probe in this
  // suite's random namespace, even if another suite has installed public migration 67.
  function privateScope(client: typeof state.client): typeof sql {
    return new Proxy(client, {
      apply(target, receiver, args) {
        const parts = args[0] as TemplateStringsArray;
        const qualify = (value: string) => value.replace(/public\.agent_source_text_witnesses/g, `"${schema}".agent_source_text_witnesses`);
        return Reflect.apply(target, receiver, [Object.assign(parts.map(qualify), { raw: parts.raw.map(qualify) }), ...args.slice(1)]);
      },
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as typeof sql;
  }
  function ordinaryResult(selected: Awaited<ReturnType<typeof seed>>, output: string | null, status: ReadResult["status"] = "completed"): ReadResult {
    const rows = output ? tableRowsFromText(output, "pdf_layout") : [];
    return { sourceDocumentId: selected.document, institutionId: selected.institution, institutionName: "Owned Rosetta Policy Bank",
      sourceUrl: "https://fixture.invalid/fees.pdf", status, documentType: "pdf", contentType: "application/pdf", sourceHash,
      textHash: output == null ? null : hashText(output), charCount: output?.length ?? 0,
      error: status === "failed" ? "Owned ordinary read failure" : null, attemptOutcome: status === "failed" ? "network_error" : "ok",
      strategy: "read.pdf_layout", format: "pdf_text", routerReason: null, fromVault: true, pageCheck: null,
      tableRows: rows.length, rows, reader: "read.pdf_layout", followUps: [], handoff: null, reread: false, durationMs: 0 };
  }
  async function failOrdinaryProfile(selected: Awaited<ReturnType<typeof seed>>, improved: string) {
    await state.client.unsafe(`CREATE FUNCTION "${schema}".fail_ordinary_profile() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF (SELECT text_hash FROM "${schema}".agent_source_texts WHERE id = ${selected.artifact})
          IS DISTINCT FROM '${hashText(improved)}' OR
          (SELECT jsonb_array_length(table_rows->'rows') FROM "${schema}".agent_source_texts WHERE id = ${selected.artifact}) IS DISTINCT FROM 4 THEN
          RAISE EXCEPTION 'owned ordinary later-write precondition not reached';
        END IF;
        RAISE EXCEPTION 'owned ordinary profile failure' USING ERRCODE = 'P0001';
      END $fn$`);
    await state.client.unsafe(`CREATE TRIGGER fail_ordinary_profile BEFORE INSERT OR UPDATE ON "${schema}".institution_source_profiles
      FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_ordinary_profile()`);
  }
  async function removeOrdinaryFailure() {
    await state.client.unsafe(`DROP TRIGGER IF EXISTS fail_ordinary_profile ON "${schema}".institution_source_profiles`);
    await state.client.unsafe(`DROP FUNCTION IF EXISTS "${schema}".fail_ordinary_profile()`);
  }

  it("ordinary root writes roll back together, and an explicit subsequent invocation can succeed", async () => {
    expect(await normalizedWitnessSchemaReady(sql)).toBe(false);
    const selected = await seed(text);
    const [beforeArtifact] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const [beforeProfile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const improved = `${text}\nWire transfer fee | $25.00`;
    await failOrdinaryProfile(selected, improved);
    try {
      await expect(recordReadResult(sql, 900, ordinaryResult(selected, improved), improved, true))
        .rejects.toMatchObject({ code: "P0001", message: "owned ordinary profile failure" });
      expect((await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(beforeArtifact);
      expect((await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(beforeProfile);
    } finally { await removeOrdinaryFailure(); }
    const result = ordinaryResult(selected, improved);
    // This is an explicit test invocation after fixing storage, not a new runtime retry.
    await recordReadResult(sql, 900, result, improved, true);
    expect(result.witnessRetention).toEqual({ status: "unavailable_schema" });
    const [stored] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    expect(stored).toMatchObject({ normalized_text: improved, text_hash: hashText(improved), document_kind: "fee_schedule", reader: "read.pdf_layout" });
    expect(stored.table_rows.rows).toHaveLength(4);
    expect(Number((await sql`SELECT last_successful_text_id FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0].last_successful_text_id)).toBe(selected.artifact);
    expect(await sql`SELECT * FROM ai_api_usage_events`).toHaveLength(0);
    expect(await sql`SELECT * FROM pipeline_attempts`).toHaveLength(1);
  });

  it("a failed inner savepoint preserves unrelated caller work without committing partial artifacts", async () => {
    const selected = await seed(text);
    const [beforeArtifact] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const [beforeProfile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const improved = `${text}\nWire transfer fee | $25.00`;
    await failOrdinaryProfile(selected, improved);
    try {
      await state.client.begin(async (tx) => {
        const scope = privateScope(tx as unknown as typeof state.client);
        expect(typeof (scope as unknown as { savepoint?: unknown }).savepoint).toBe("function");
        await scope`UPDATE institution_sources SET institution_name = 'Unrelated caller work kept' WHERE id = ${selected.institution}`;
        await expect(recordReadResult(scope, 900, ordinaryResult(selected, improved), improved, true))
          .rejects.toMatchObject({ code: "P0001", message: "owned ordinary profile failure" });
        expect((await scope`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(beforeArtifact);
        expect((await scope`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(beforeProfile);
        expect((await scope`SELECT institution_name FROM institution_sources WHERE id = ${selected.institution}`)[0].institution_name).toBe("Unrelated caller work kept");
      });
    } finally { await removeOrdinaryFailure(); }
    expect((await sql`SELECT institution_name FROM institution_sources WHERE id = ${selected.institution}`)[0].institution_name).toBe("Unrelated caller work kept");
    expect((await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(beforeArtifact);
    expect((await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(beforeProfile);
  });

  it("successful inner writes remain subject to the caller's outer rollback", async () => {
    const selected = await seed(text);
    const [beforeArtifact] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const [beforeProfile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const improved = `${text}\nWire transfer fee | $25.00`;
    await expect(state.client.begin(async (tx) => {
      const scope = privateScope(tx as unknown as typeof state.client);
      await recordReadResult(scope, 900, ordinaryResult(selected, improved), improved, true);
      expect((await scope`SELECT normalized_text FROM agent_source_texts WHERE id = ${selected.artifact}`)[0].normalized_text).toBe(improved);
      expect((await scope`SELECT table_rows FROM agent_source_texts WHERE id = ${selected.artifact}`)[0].table_rows.rows).toHaveLength(4);
      throw new Error("owned caller outer rollback");
    })).rejects.toThrow("owned caller outer rollback");
    expect((await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(beforeArtifact);
    expect((await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(beforeProfile);
  });

  it("companion reads keep the main profile while storing their own complete artifact group", async () => {
    const selected = await seed(text);
    await sql`UPDATE source_documents SET companion_source_id = 789 WHERE id = ${selected.document}`;
    const [beforeProfile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    const improved = `${text}\nWire transfer fee | $25.00`;
    const result = ordinaryResult(selected, improved);
    await recordReadResult(sql, 900, result, improved, true);
    const [stored] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    expect(stored).toMatchObject({ normalized_text: improved, document_kind: "fee_schedule", reader: "read.pdf_layout" });
    expect(stored.table_rows.rows).toHaveLength(4);
    expect((await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`)[0]).toEqual(beforeProfile);
    expect(result.witnessRetention).toEqual({ status: "unavailable_schema" });
  });

  it("legacy column mode still preserves existing kind/table/reader columns", async () => {
    const selected = await seed(text);
    const priorRows = tableRowsPayload(tableRowsFromText(text, "pdf_layout"));
    await sql`UPDATE agent_source_texts SET table_rows = ${JSON.stringify(priorRows)}::jsonb,
      document_kind = 'fee_schedule', document_kind_version = 1, reader = 'legacy_fixture' WHERE id = ${selected.artifact}`;
    const [before] = await sql`SELECT document_kind, document_kind_version, table_rows, reader FROM agent_source_texts WHERE id = ${selected.artifact}`;
    const improved = `${text}\nWire transfer fee | $25.00`;
    await recordReadResult(sql, 900, ordinaryResult(selected, improved), improved, false);
    expect((await sql`SELECT document_kind, document_kind_version, table_rows, reader FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toEqual(before);
    expect((await sql`SELECT normalized_text FROM agent_source_texts WHERE id = ${selected.artifact}`)[0].normalized_text).toBe(improved);
  });

  it("failed null-text writes still clear derived text fields and retain the prior successful profile pointer", async () => {
    const selected = await seed(text);
    const priorRows = tableRowsPayload(tableRowsFromText(text, "pdf_layout"));
    await sql`UPDATE agent_source_texts SET table_rows = ${JSON.stringify(priorRows)}::jsonb,
      document_kind = 'fee_schedule', document_kind_version = 1 WHERE id = ${selected.artifact}`;
    const result = ordinaryResult(selected, null, "failed");
    await recordReadResult(sql, 900, result, null, true);
    expect((await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`)[0]).toMatchObject({
      status: "failed", normalized_text: null, text_hash: null, char_count: 0,
      document_kind: null, document_kind_version: null, table_rows: null, error_message: "Owned ordinary read failure",
    });
    const [profile] = await sql`SELECT * FROM institution_source_profiles WHERE institution_id = ${selected.institution}`;
    expect(Number(profile.last_successful_text_id)).toBe(selected.artifact);
    expect(profile.last_failure_reason).toBe("Owned ordinary read failure");
    expect(profile.consecutive_failures).toBe(1);
    expect(result.witnessRetention).toEqual({ status: "unavailable_schema" });
  });

  it("stores an unknown-cost usable partial with active main witness retention and matching produced/retained provenance", async () => {
    await enableWitnessCapability(); const selected = await seed(text);
    const improved = `${text}\nWire transfer fee | $25.00`;
    const { result, create } = await run("model_context_window_exceeded", { input_tokens: "invalid", output_tokens: 20 }, improved);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ succeeded: 1, failed: 0, costMicrousd: 0, unknownCostResponses: 1 });
    const retention = { status: "active", incumbent: "captured", incoming: "captured" };
    expect(result.results[0]).toMatchObject({ outcome: "ok_partial", cost_microusd: null, response_complete: false,
      produced_text_hash: hashText(improved), retained_text_hash: hashText(improved), witness_retention: retention });
    const [artifact] = await sql`SELECT * FROM agent_source_texts WHERE id = ${selected.artifact}`;
    expect(artifact).toMatchObject({ status: "completed", normalized_text: improved, text_hash: hashText(improved), reader: PAID_READ_STRATEGY });
    expect(artifact.table_rows.rows).toHaveLength(4);
    const witnesses = await sql`SELECT text_hash, normalized_text, source_hash FROM agent_source_text_witnesses WHERE artifact_id = ${selected.artifact}`;
    expect(witnesses).toHaveLength(2);
    expect(witnesses).toEqual(expect.arrayContaining([
      expect.objectContaining({ text_hash: hashText(text), normalized_text: text, source_hash: sourceHash }),
      expect.objectContaining({ text_hash: hashText(improved), normalized_text: improved, source_hash: sourceHash }),
    ]));
    const [attempt] = await sql`SELECT outcome, detail FROM pipeline_attempts WHERE strategy = ${PAID_READ_STRATEGY}`;
    expect(attempt).toMatchObject({ outcome: "ok_partial", detail: { truncated: true, cost_is_placeholder: true,
      cost_microusd: null, selected_source_hash: sourceHash, produced_text_hash: hashText(improved), retained_text_hash: hashText(improved), witness_retention: retention } });
    const [event] = await sql`SELECT estimated_cost_microusd, metadata FROM ai_api_usage_events`;
    expect(event).toMatchObject({ estimated_cost_microusd: null, metadata: { usage_observation: "unknown", response_complete: false } });
  });
});
