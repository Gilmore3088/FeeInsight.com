import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { correctPublishedFee, resetCorrectionsReadyCache } from "@/lib/fee-corrections";
import { CAPTURE_CHECK, correctiveMemberWindow, type CorrectiveMemberKey, loadCorrectiveCaseCandidates, runCorrectiveSource, persistCorrectiveArtifact, recordCorrectiveWarnings, sealCorrectiveSource } from "./corrective-source-store";
import { recordAdminFeeRun } from "@/lib/fee-admin-run";
import { runDemingRegression } from "./regression";
import { recordFeedback } from "@/lib/agents/learning/feedback";
import { runStorageRetention, RETENTION_LIVE } from "@/lib/agents/atlas/storage-retention";
import { validCorrectiveReceipt, fixtureArtifact, evidenceHash, encodedBytes, type FixtureArtifact } from "./corrective-source";
import * as correctivePolicy from "./corrective-source";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20640001, DOC = 20640101;
const EVENT = "00000000-0000-4000-8000-000020640001";
const TEXT = "OTHER SERVICES\nWire Transfer | $25.00\nStop Payment Fee | $35.00";
type Db = Parameters<typeof correctPublishedFee>[0];

describe.skipIf(!connection)("prospective corrective source context in actual PostgreSQL", () => {
  let raw: postgres.Sql, db: Db, oldId: number, correctionId: number, originRunId: number;
  let metadataSql=""; let metadataParams:unknown[]=[];
  async function anotherCorrection(key: string = randomUUID(), evidenceDoc = DOC) {
    const event = randomUUID();
    const [r] = await raw`INSERT INTO raw_fee_observations(institution_id,source_document_id,agent_event_id,fee_name,amount,frequency,source)
      VALUES(${INST},${DOC},${event},'Stop Payment Fee',25,'per_item','manual_import') RETURNING fee_raw_id`;
    const [v] = await raw`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,review_status)
      VALUES(${r.fee_raw_id},${INST},'stop_payment',${event},'Stop Payment Fee',25,'per_item','verified') RETURNING fee_verified_id`;
    const [p] = await raw`INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount,frequency,batch_id)
      VALUES(${v.fee_verified_id},${INST},'stop_payment',${event},'Stop Payment Fee',25,'per_item','prospective-correction') RETURNING fee_published_id`;
    const input = { feePublishedId: Number(p.fee_published_id), expectedVersion: 0, idempotencyKey: key, canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee",
      amount: "35", frequency: "per_item", conditions: "", sourceDocumentId: evidenceDoc, sourceExcerpt: "Stop Payment Fee | $35.00", sourceLocation: "row 2", reason: "Correct the adjacent price" };
    const result = await correctPublishedFee(db, input, { id: 1, name: "James", role: "admin" });
    expect(result.ok).toBe(true); if (!result.ok) throw new Error("Correction fixture failed");
    return { result, input, rawId: Number(r.fee_raw_id), verifiedId: Number(v.fee_verified_id) };
  }
  async function removeCorrection(c: Awaited<ReturnType<typeof anotherCorrection>>) {
    await raw`DELETE FROM eval_cases WHERE case_key=${`corrective:${c.result.correctionId}:source_snapshot_v2`}`;
    await raw`DELETE FROM published_fee_corrections WHERE id=${c.result.correctionId}`;
    await raw`DELETE FROM pipeline_feedback WHERE dedupe_key=${`admin.fee_correction:${c.result.correctionId}`}`;
    await raw`DELETE FROM published_fee_records WHERE fee_published_id IN(${c.result.feePublishedId},${c.result.previousFeePublishedId})`;
    await raw`DELETE FROM verified_fee_observations WHERE fee_verified_id=${c.verifiedId}`;
    await raw`DELETE FROM raw_fee_observations WHERE fee_raw_id=${c.rawId}`;
    await raw`DELETE FROM agent_runs WHERE id=${c.result.runId}`;
  }
  // The e2e job shares one database across files; a live corrected fee left here is read by later
  // suites that scan every older live row (Darwin's older-live shadow), so clear it on both ends.
  async function clearFixture() {
    await raw`DELETE FROM eval_cases WHERE institution_id=${INST}`;
    await raw`DELETE FROM published_fee_corrections WHERE institution_id=${INST}`;
    await raw`DELETE FROM pipeline_feedback WHERE institution_id=${INST}`;
    await raw`DELETE FROM published_fee_records WHERE institution_id=${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id=${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id=${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id=${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id=${INST}`;
    await raw`DELETE FROM institution_sources WHERE id=${INST}`;
  }
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Loopback fixture required");
    raw = postgres(connection, { ssl: "require", max: 1, debug: (_id,query,params) => { if(query.includes("SELECT id,case_bytes::int,database_digest FROM eligible ORDER BY id LIMIT")) { metadataSql=query; metadataParams=params; } }, types: { json: JSON_TEXT_PASSTHROUGH, numeric: NUMERIC_AS_NUMBER, text: TEXT_WITHOUT_NUL } });
    db = raw as unknown as Db;
    resetCorrectionsReadyCache();
    await clearFixture();
    await raw`INSERT INTO institution_sources(id,institution_name,charter_type,source,state_code) VALUES(${INST},'Corrective Context Fixture','bank','fdic','TX')`;
    await raw`INSERT INTO source_documents(id,institution_id,status,document_url,content_hash) VALUES(${DOC},${INST},'success','https://fixture.invalid/fees','fixture-byte-edition')`;
    await raw`INSERT INTO agent_source_texts(source_document_id,institution_id,status,normalized_text,text_hash,source_hash) VALUES(${DOC},${INST},'completed',${TEXT},${createHash("sha256").update(TEXT).digest("hex")},'fixture-byte-edition')`;
    const [r] = await raw`INSERT INTO raw_fee_observations(institution_id,source_document_id,agent_event_id,fee_name,amount,frequency,source) VALUES(${INST},${DOC},${EVENT},'Stop Payment Fee',25,'per_item','knox') RETURNING fee_raw_id`;
    const [v] = await raw`INSERT INTO verified_fee_observations(fee_raw_id,institution_id,canonical_fee_key,verified_by_agent_event_id,fee_name,amount,frequency,review_status) VALUES(${r.fee_raw_id},${INST},'stop_payment',${EVENT},'Stop Payment Fee',25,'per_item','verified') RETURNING fee_verified_id`;
    const [p] = await raw`INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount,frequency,batch_id,source_url) VALUES(${v.fee_verified_id},${INST},'stop_payment',${EVENT},'Stop Payment Fee',25,'per_item','corrective-source-fixture','https://fixture.invalid/fees') RETURNING fee_published_id`;
    oldId = Number(p.fee_published_id);
    // More than a whole promotion batch of representable, known-invalid packets before the genuine
    // correction. The actual loader must filter them server-side before LIMIT, without their bodies.
    await raw`WITH copies AS (
      INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount,frequency,batch_id,rolled_back_at)
      SELECT ${v.fee_verified_id},${INST},'stop_payment',${EVENT},'Stop Payment Fee',35,'per_item','invalid-corrective-prefix',NOW()
      FROM generate_series(1,301) RETURNING fee_published_id
    ), numbered AS (SELECT fee_published_id,row_number() OVER(ORDER BY fee_published_id) AS n FROM copies)
    INSERT INTO published_fee_corrections(fee_chain_id,version,action,status,superseded_at,institution_id,previous_fee_published_id,fee_published_id,
      before_canonical_fee_key,before_fee_name,before_amount,before_frequency,canonical_fee_key,fee_name,amount,frequency,
      source_document_id,source_excerpt,source_location,source_check,reason,actor_user_id,actor_name,idempotency_key)
    SELECT ${oldId},100+n,'correct','superseded',NOW(),${INST},${oldId},fee_published_id,'stop_payment','Stop Payment Fee',25,'per_item',
      'stop_payment','Stop Payment Fee',35,'per_item',${DOC},'Stop Payment Fee | $35.00','row 2',
      jsonb_build_object('deming_source_v2',CASE (n%6) WHEN 0 THEN 'null'::jsonb WHEN 1 THEN 'true'::jsonb WHEN 2 THEN '"{}"'::jsonb
        WHEN 3 THEN '[]'::jsonb WHEN 4 THEN '{"protocol":2,"payload":{"documents":[]}}'::jsonb
        ELSE '{"protocol":2,"payload":{"documents":[{},{},{},{},{},{},{},{}]}}'::jsonb END),
      'Controlled unavailable prefix',1,'James','invalid-prefix:'||${INST}::text||':'||n::text FROM numbered`;
  });
  afterAll(async () => { if (!raw) return; try { await clearFixture(); } finally { await raw.end(); } });
  it("seals the real authorized correction with a complete source-bound canonical receipt", async () => {
    const result = await correctPublishedFee(db, { feePublishedId: oldId, expectedVersion: 0, idempotencyKey: "corrective-v2-real-authorized-2064", canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amount: "35", frequency: "per_item", conditions: "", sourceDocumentId: DOC, sourceExcerpt: "Stop Payment Fee | $35.00", sourceLocation: "Other services row 2", reason: "Correct the adjacent row amount" }, { id: 1, name: "James", role: "admin" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("The genuine correction did not succeed");
    correctionId = result.correctionId; originRunId = result.runId!;
    const [c] = await raw`SELECT source_check FROM published_fee_corrections WHERE id=${result.correctionId}`;
    expect(validCorrectiveReceipt(c.source_check.deming_source_v2)).toBe(true);
    expect(c.source_check.deming_source_v2).toMatchObject({ protocol: 2, payload: { context: "human_validated_edition", originalExtractionBinding: "unknown", documents: [{ normalizedText: TEXT }] } });
  });
  it("enrolls the genuine correction and replays both the old refusal and the corrected positive", async () => {
    expect(await loadCorrectiveCaseCandidates(db)).toEqual([expect.objectContaining({ id: correctionId })]);
    const result = await runCorrectiveSource({ db, runId: null, dryRun: false });
    expect(result).toMatchObject({ promoted: 1, evaluated: 1, caught: 1, activated: 1, regressions: 0 });
    expect(result.artifact.caseCount).toBe(1);
    const [c] = await raw`SELECT status,input,source_text_hash FROM eval_cases WHERE institution_id=${INST}`;
    expect(c.status).toBe("active"); expect(c.source_text_hash).toBeNull();
    expect(c.input.receipt.payload.originalExtractionBinding).toBe("unknown");
    expect((await runCorrectiveSource({ db, runId: null, dryRun: false })).promoted).toBe(0);
  });
  it("stores an actual bounded fixture event on the actual Deming run and step", async () => {
    const [r] = await raw`INSERT INTO agent_runs(agent_name,run_kind,title,status) VALUES('atlas','workflow','Fixture generation','running') RETURNING id`;
    const [s] = await raw`INSERT INTO agent_run_steps(agent_run_id,agent_name,step_key,title,status) VALUES(${r.id},'atlas','deming-regression','Corrective replay','running') RETURNING id`;
    const result = await runCorrectiveSource({ db, runId: Number(r.id), dryRun: false });
    expect(await persistCorrectiveArtifact(db, Number(r.id), Number(s.id), result.artifact)).toMatchObject({ state: "stored", cases: 1, chunks: 1, ciImport: "not_implemented" });
    expect(await persistCorrectiveArtifact(db, Number(r.id), Number(s.id), result.artifact)).toMatchObject({ state: "stored" });
    const events = await raw`SELECT detail FROM agent_run_events WHERE agent_run_id=${r.id} AND event_type='deming.fixture.v2'`;
    expect(events).toHaveLength(1); expect(events[0].detail.cases[0].outcome).toMatchObject({ evaluated: true, caught: true });
  });

  it("rejects artifact payload tampering with unchanged receipt digests and validates actual envelopes before SQL", async () => {
    const [r]=await raw`INSERT INTO agent_runs(agent_name,run_kind,title,status) VALUES('atlas','workflow','Artifact authority controls','running') RETURNING id`;
    const [step]=await raw`INSERT INTO agent_run_steps(agent_run_id,agent_name,step_key,title,status) VALUES(${r.id},'atlas','deming-regression','Artifact authority controls','running') RETURNING id`;
    const result=await runCorrectiveSource({db,runId:Number(r.id),dryRun:false});
    const tampered=structuredClone(result.artifact.chunks[0].cases[0]);
    tampered.input.receipt.payload.feeContext.lineage_product_name='Invented metadata retaining the receipt digests';
    expect(validCorrectiveReceipt(tampered.input.receipt)).toBe(true); // Pure shape is deliberately not canonical authority.
    expect(await persistCorrectiveArtifact(db,Number(r.id),Number(step.id),fixtureArtifact([tampered]))).toMatchObject({state:'unavailable',cases:0});
    expect(await raw`SELECT id FROM agent_run_events WHERE agent_run_id=${r.id} AND event_type='deming.fixture.v2'`).toHaveLength(0);
    expect(await persistCorrectiveArtifact(db,Number(r.id),Number(step.id),result.artifact)).toMatchObject({state:'stored',cases:1});
    let admitted=0;
    const noSql=new Proxy(db,{get(target,key,receiver){if(key==='savepoint'||key==='begin')return()=>{admitted++;throw new Error('Must reject before SQL');};return Reflect.get(target,key,receiver);}});
    for(const sizes of [[2*1024*1024],[1800000,1800000,1800000,1800000,1800000]]) {
      const chunks=sizes.map((size,index)=>({...structuredClone(result.artifact.chunks[0]),index,padding:'x'.repeat(size)}));
      chunks.forEach((chunk,index)=>{chunk.cases[0].caseId=index+1;});
      const over={protocol:2,chunks,caseCount:chunks.length,bytes:chunks.reduce((n,c)=>n+encodedBytes(c),0),complete:true,digest:evidenceHash(chunks)} as FixtureArtifact;
      expect(await persistCorrectiveArtifact(noSql,Number(r.id),Number(step.id),over)).toMatchObject({state:'unavailable',cases:0});
    }
    expect(admitted).toBe(0);
    expect(await persistCorrectiveArtifact(db,Number(r.id),Number(step.id),fixtureArtifact([]))).toMatchObject({state:'not_generated',cases:0});
  });
  it("keeps a both-accepted candidate unactivated and counts an active checker regression only when evaluated", async () => {
    const c=await anotherCorrection();
    const actual=correctivePolicy.replayCorrective;
    const spy=vi.spyOn(correctivePolicy,'replayCorrective').mockImplementation(input=>{
      const packet=input as {receipt?:{payload?:{canonical?:{id?:number}}}};
      return packet.receipt?.payload?.canonical?.id===c.result.correctionId
        ? {evaluated:true,caught:false,verdict:'both_accepted'} : actual(input);
    });
    try {
      const first=await runCorrectiveSource({db,runId:null,dryRun:false});
      expect(first).toMatchObject({promoted:1,evaluated:2,caught:1,activated:0,regressions:0});
      const [row]=await raw`SELECT status,last_verdict FROM eval_cases WHERE case_key=${`corrective:${c.result.correctionId}:source_snapshot_v2`}`;
      expect(row).toMatchObject({status:'candidate',last_verdict:'both_accepted'});
      spy.mockRestore();
      expect(await runCorrectiveSource({db,runId:null,dryRun:false})).toMatchObject({promoted:0,evaluated:2,caught:2,activated:1,regressions:0});
      const activeSpy=vi.spyOn(correctivePolicy,'replayCorrective').mockImplementation(input=>{
        const packet=input as {receipt?:{payload?:{canonical?:{id?:number}}}};
        return packet.receipt?.payload?.canonical?.id===c.result.correctionId
          ? {evaluated:true,caught:false,verdict:'corrected_refused'} : actual(input);
      });
      try {expect(await runCorrectiveSource({db,runId:null,dryRun:false})).toMatchObject({evaluated:2,caught:1,activated:0,regressions:1});}
      finally {activeSpy.mockRestore();}
    } finally {spy.mockRestore();await removeCorrection(c);}
  });

  it("continues trusted replay after origin event/step/run pruning without inventing a new original binding", async () => {
    const [sealed] = await raw`SELECT source_check FROM published_fee_corrections WHERE id=${correctionId}`;
    const receipt = sealed.source_check.deming_source_v2;
    const eventId = receipt.payload.origin.event.id;
    const stepId = receipt.payload.origin.step.id;
    await raw`UPDATE agent_run_events SET created_at=NOW()-interval '95 days' WHERE id=${eventId}`;
    const [newer] = await raw`INSERT INTO agent_run_events(agent_run_id,step_id,event_type,status,message,detail)
      VALUES(${originRunId},${stepId},'fee.correct','completed','Controlled newer event','{}'::jsonb) RETURNING id`;
    const policies = Object.fromEntries(Object.keys(RETENTION_LIVE).map((key) => [key, key === "run_events"]));
    const trim = await runStorageRetention({ db, live: policies });
    expect(trim.trims.find((t) => t.policy === "run_events")?.deleted).toBeGreaterThanOrEqual(1);
    expect(await raw`SELECT id FROM agent_run_events WHERE id=${eventId}`).toHaveLength(0);
    expect(await raw`SELECT id FROM agent_run_events WHERE id=${newer.id}`).toHaveLength(1);
    expect((await runCorrectiveSource({ db, runId: null, dryRun: false })).evaluated).toBe(1);
    await raw`DELETE FROM agent_run_steps WHERE id=${stepId}`;
    expect((await runCorrectiveSource({ db, runId: null, dryRun: false })).evaluated).toBe(1);
    await raw`DELETE FROM agent_runs WHERE id=${originRunId}`;
    const [c] = await raw`SELECT agent_run_id,source_check FROM published_fee_corrections WHERE id=${correctionId}`;
    expect(c.agent_run_id).toBeNull(); expect(c.source_check).toEqual(sealed.source_check);
    expect((await runCorrectiveSource({ db, runId: null, dryRun: false }))).toMatchObject({ evaluated: 1, caught: 1 });
  });
  it("rejects altered/missing canonical receipts after pruning even when a case checksum is self-consistent", async () => {
    const [original] = await raw`SELECT source_check FROM published_fee_corrections WHERE id=${correctionId}`;
    for (const bad of [null, "{}", {}, { protocol: 2, state: "unavailable" }]) {
      await raw`UPDATE published_fee_corrections SET source_check=jsonb_build_object('deming_source_v2',${JSON.stringify(bad)}::jsonb) WHERE id=${correctionId}`;
      const result = await runCorrectiveSource({ db, runId: null, dryRun: false });
      expect(result.evaluated).toBe(0); expect(result.caught).toBe(0); expect(result.regressions).toBe(0);
      const [c] = await raw`SELECT status FROM eval_cases WHERE institution_id=${INST}`;
      expect(c.status).toBe("active"); // history preserved, not used as a denominator
    }
    await raw`UPDATE published_fee_corrections SET source_check=${JSON.stringify(original.source_check)}::jsonb WHERE id=${correctionId}`;
    expect((await runCorrectiveSource({ db, runId: null, dryRun: false })).evaluated).toBe(1);
  });

  it("keeps the authorized fee correction committed when optional snapshot SQL fails in its real savepoint", async () => {
    const key = "controlled-snapshot-failure-2064";
    await raw`CREATE FUNCTION pg_temp.reject_optional_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.idempotency_key='controlled-snapshot-failure-2064' AND NEW.source_check->'deming_source_v2' ? 'payload' THEN
        RAISE EXCEPTION 'controlled optional observer failure'; END IF; RETURN NEW; END$$`;
    await raw`CREATE TRIGGER corrective_optional_failure BEFORE UPDATE ON published_fee_corrections FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_optional_snapshot()`;
    let c: Awaited<ReturnType<typeof anotherCorrection>> | undefined;
    try {
      c = await anotherCorrection(key);
      const [saved] = await raw`SELECT source_check FROM published_fee_corrections WHERE id=${c.result.correctionId}`;
      expect(saved.source_check.deming_source_v2).toMatchObject({ state: "unavailable", reason: "snapshot_unavailable" });
      const [fee] = await raw`SELECT amount,rolled_back_at FROM published_fee_records WHERE fee_published_id=${c.result.feePublishedId}`;
      expect(Number(fee.amount)).toBe(35); expect(fee.rolled_back_at).toBeNull();
      expect(await raw`SELECT id FROM agent_run_events WHERE agent_run_id=${c.result.runId} AND event_type='index.refresh'`).toHaveLength(1);
      expect(await raw`SELECT message FROM agent_run_events WHERE agent_run_id=${c.result.runId} AND event_type='step.warning' AND detail->>'check'=${CAPTURE_CHECK}`)
        .toEqual([{ message: expect.stringContaining("failed, no snapshot sealed: controlled optional observer failure") }]);
      expect(await correctPublishedFee(db, c.input, { id: 1, name: "James", role: "admin" })).toMatchObject({ ok: true, replay: true });
      expect((await loadCorrectiveCaseCandidates(db)).some((row) => row.id === c!.result.correctionId)).toBe(false);
    } finally {
      await raw`DROP TRIGGER corrective_optional_failure ON published_fee_corrections`;
      if (c) await removeCorrection(c);
    }
  });
  it("does not consume a key on a failed enrollment statement and retries once after savepoint rollback", async () => {
    const c = await anotherCorrection();
    await raw`CREATE FUNCTION pg_temp.reject_corrective_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.input->>'kind'='corrective_publication_v2' THEN RAISE EXCEPTION 'controlled case write failure'; END IF; RETURN NEW; END$$`;
    await raw`CREATE TRIGGER corrective_enrollment_failure BEFORE INSERT ON eval_cases FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_corrective_enrollment()`;
    try {
      await raw.begin(async (native) => {
        const tx = native as unknown as typeof raw;
        const result = await runCorrectiveSource({ db: tx as unknown as Db, runId: null, dryRun: false });
        expect(result.promoted).toBe(0);
        expect(await tx`SELECT id FROM eval_cases WHERE case_key=${`corrective:${c.result.correctionId}:source_snapshot_v2`}`).toHaveLength(0);
        expect((await tx`SELECT 1 AS healthy`)[0].healthy).toBe(1); // actual enclosing transaction still usable
      });
    } finally { await raw`DROP TRIGGER corrective_enrollment_failure ON eval_cases`; }
    expect((await runCorrectiveSource({ db, runId: null, dryRun: false })).promoted).toBe(1);
    expect((await runCorrectiveSource({ db, runId: null, dryRun: false })).promoted).toBe(0);
    await removeCorrection(c);
  });
  it("requires live original origins at initial enrollment; pruning cannot be replaced by a checksum", async () => {
    const c = await anotherCorrection();
    await raw`DELETE FROM agent_run_events WHERE agent_run_id=${c.result.runId} AND event_type='fee.correct'`;
    const result = await runCorrectiveSource({ db, runId: null, dryRun: false });
    expect(result.promoted).toBe(0);
    expect(await raw`SELECT id FROM eval_cases WHERE case_key=${`corrective:${c.result.correctionId}:source_snapshot_v2`}`).toHaveLength(0);
    expect(result.unavailable.count).toBeGreaterThan(0);
    await removeCorrection(c);
  });
  it("excludes legacy source history before replay LIMIT while retaining the golden/limit policy", async () => {
    const [c] = await raw`INSERT INTO eval_cases(case_key,dataset,status,agent,check_name,error_class,severity,input,expected,label_provenance,institution_id)
      VALUES('legacy-source-2064','regression','active','hamilton','hamilton.source_check','unknown','major',
      '{"kind":"source_check","texts":[]}'::jsonb,'{}'::jsonb,'takedown_confirmed',${INST}) RETURNING id`;
    const result = await runCorrectiveSource({ db, runId: null, dryRun: false, replayLimit: 1 });
    expect(result.evaluated).toBe(1); expect(result.regressions).toBe(0);
    const [legacy] = await raw`SELECT input,status,last_checked_at FROM eval_cases WHERE id=${c.id}`;
    expect(legacy).toMatchObject({ input: { kind: "source_check", texts: [] }, status: "active", last_checked_at: null });
    await raw`DELETE FROM eval_cases WHERE id=${c.id}`;
  });

  it("filters every required malformed/owner/hash/whole-body/encoded-cap class before admission", async () => {
    const c = await anotherCorrection();
    const [saved] = await raw`SELECT source_check FROM published_fee_corrections WHERE id=${c.result.correctionId}`;
    type Packet = typeof saved.source_check.deming_source_v2;
    const mutations: Array<[string, (p: Packet) => unknown]> = [
      ["null", () => null], ["scalar", () => false], ["string wrapped", () => "{}"],
      ["missing source", (p) => { p.payload.documents=[]; return p; }],
      ["two sources", (p) => { p.payload.documents.push(p.payload.documents[0]); return p; }],
      ["eight sources", (p) => { p.payload.documents=Array(8).fill(p.payload.documents[0]); return p; }],
      ["foreign document owner", (p) => { p.payload.documents[0].institutionId++; return p; }],
      ["foreign normalization owner", (p) => { p.payload.documents[0].astInstitutionId++; return p; }],
      ["missing normalization", (p) => { p.payload.documents[0].astId=999999999; return p; }],
      ["selected edition mismatch", (p) => { p.payload.documents[0].sourceHash="different-edition"; return p; }],
      ["declared hash mismatch", (p) => { p.payload.documents[0].textHash="0".repeat(64); return p; }],
      ["missing body", (p) => { p.payload.documents[0].normalizedText=null; return p; }],
      ["empty body", (p) => { p.payload.documents[0].normalizedText=""; return p; }],
      ["codepoint cap", (p) => { p.payload.documents[0].normalizedText="x".repeat(200001); return p; }],
      ["raw byte cap", (p) => { p.payload.documents[0].normalizedText="😀".repeat(200001); return p; }],
      ["escaped encoded cap", (p) => { p.payload.documents[0].normalizedText="\u0001".repeat(199950)+"\nStop Payment Fee | $35.00"; p.payload.documents[0].textHash=createHash("sha256").update(p.payload.documents[0].normalizedText).digest("hex"); return p; }],
      ["forged origin ID", (p) => { p.payload.origin.event.id=99999999; return p; }],
      ["spoofed actor", (p) => { p.payload.origin.run.triggered_by="user:999"; return p; }],
      ["canonical semantics mismatch", (p) => { p.payload.canonical.reason="Different label context"; return p; }],
      ["unsupported rate", (p) => { p.payload.feeContext.amount_kind="percentage"; return p; }],
    ];
    try {
      for (const [label, mutate] of mutations) {
        const packet = mutate(structuredClone(saved.source_check.deming_source_v2));
        await raw`UPDATE published_fee_corrections SET source_check=jsonb_build_object('deming_source_v2',${JSON.stringify(packet)}::jsonb) WHERE id=${c.result.correctionId}`;
        // Even a self-rehashed packet cannot replace canonical/source/origin authority or byte bounds.
        await raw`UPDATE published_fee_corrections SET source_check=jsonb_set(source_check,'{deming_source_v2}',
          (source_check->'deming_source_v2') || jsonb_build_object('digest',encode(digest((source_check->'deming_source_v2'->'payload')::text,'sha256'),'hex'),
            'databaseDigest',encode(digest((source_check->'deming_source_v2'->'payload')::text,'sha256'),'hex')))
          WHERE id=${c.result.correctionId} AND jsonb_typeof(source_check->'deming_source_v2')='object'`;
        expect((await loadCorrectiveCaseCandidates(db)).some((row) => row.id===c.result.correctionId),label).toBe(false);
      }
    } finally { await removeCorrection(c); }
  });

  it("keeps a genuine later-edition correction usable without calling it an original extraction error", async () => {
    const later=DOC+1;
    await raw`INSERT INTO source_documents(id,institution_id,status,document_url,content_hash) VALUES(${later},${INST},'success','https://fixture.invalid/later-fees','later-edition')`;
    await raw`INSERT INTO agent_source_texts(source_document_id,institution_id,status,normalized_text,text_hash,source_hash)
      VALUES(${later},${INST},'completed',${TEXT},${createHash("sha256").update(TEXT).digest("hex")},'later-edition')`;
    const c=await anotherCorrection(randomUUID(),later);
    try {
      expect((await runCorrectiveSource({db,runId:null,dryRun:false})).promoted).toBe(1);
      const [row]=await raw`SELECT agent,error_class,source_document_id,source_text_hash,input FROM eval_cases WHERE case_key=${`corrective:${c.result.correctionId}:source_snapshot_v2`}`;
      expect(row).toMatchObject({agent:"hamilton",error_class:"corrective_publication",source_text_hash:null});
      expect(Number(row.source_document_id)).toBe(later);
      expect(row.input.receipt.payload.originalExtractionBinding).toBe("unknown");
      expect(await raw`SELECT id FROM pipeline_feedback WHERE institution_id=${INST} AND reported_by='deming'`).toHaveLength(0);
    } finally { await removeCorrection(c); }
  });
  it("preserves the authorized correction but excludes missing/null/mismatched selected edition associations", async () => {
    const mismatched=DOC+2;
    await raw`INSERT INTO source_documents(id,institution_id,status,document_url,content_hash)
      VALUES(${mismatched},${INST},'success','https://fixture.invalid/mismatched-edition','document-bytes-B')`;
    await raw`INSERT INTO agent_source_texts(source_document_id,institution_id,status,normalized_text,text_hash,source_hash)
      VALUES(${mismatched},${INST},'completed',${TEXT},${createHash("sha256").update(TEXT).digest("hex")},'normalization-bytes-A')`;
    for(const sourceHash of ['normalization-bytes-A',null,'']) {
      await raw`UPDATE agent_source_texts SET source_hash=${sourceHash} WHERE source_document_id=${mismatched}`;
      const c=await anotherCorrection(randomUUID(),mismatched);
      try {
        const [saved]=await raw`SELECT source_check FROM published_fee_corrections WHERE id=${c.result.correctionId}`;
        expect(saved.source_check.deming_source_v2,`selected association ${sourceHash}`).toMatchObject({state:"unavailable",reason:"snapshot_unavailable"});
        expect((await loadCorrectiveCaseCandidates(db)).some(row=>row.id===c.result.correctionId)).toBe(false);
        expect((await raw`SELECT amount FROM published_fee_records WHERE fee_published_id=${c.result.feePublishedId}`)[0].amount).toBe(35);
      } finally {await removeCorrection(c);}
    }
  });
  it("rechecks the exact selected AST and document after the authorized check before optional sealing", async () => {
    for(const drift of ['ast','document']) {
      await raw`CREATE OR REPLACE FUNCTION pg_temp.drift_selected_edition() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
        IF NEW.idempotency_key='drift-ast-before-seal' THEN
          UPDATE agent_source_texts SET normalized_text=normalized_text||' changed',text_hash=encode(digest(normalized_text||' changed','sha256'),'hex') WHERE source_document_id=20640101;
        ELSIF NEW.idempotency_key='drift-document-before-seal' THEN
          UPDATE source_documents SET content_hash='changed-after-check' WHERE id=20640101;
        END IF; RETURN NEW; END$$`;
      await raw`CREATE TRIGGER corrective_pre_seal_drift AFTER INSERT ON published_fee_corrections FOR EACH ROW EXECUTE FUNCTION pg_temp.drift_selected_edition()`;
      let c:Awaited<ReturnType<typeof anotherCorrection>>|undefined;
      try {
        c=await anotherCorrection(`drift-${drift}-before-seal`);
        const [saved]=await raw`SELECT source_check FROM published_fee_corrections WHERE id=${c.result.correctionId}`;
        expect(saved.source_check.deming_source_v2,drift).toMatchObject({state:"unavailable"});
        expect((await raw`SELECT amount FROM published_fee_records WHERE fee_published_id=${c.result.feePublishedId}`)[0].amount).toBe(35);
      } finally {
        await raw`DROP TRIGGER corrective_pre_seal_drift ON published_fee_corrections`;
        await raw`UPDATE agent_source_texts SET normalized_text=${TEXT},text_hash=${createHash("sha256").update(TEXT).digest("hex")},source_hash='fixture-byte-edition' WHERE source_document_id=${DOC}`;
        await raw`UPDATE source_documents SET content_hash='fixture-byte-edition' WHERE id=${DOC}`;
        if(c) await removeCorrection(c);
      }
    }
  });
  it("uses the current JSON codec as objects/arrays and preserves source-like JSON as text", async () => {
    const [row]=await raw`SELECT ${JSON.stringify({packet:[1,true,null]})}::jsonb AS object,
      ${JSON.stringify([1,true,null])}::jsonb AS array,${JSON.stringify(false)}::jsonb AS scalar,
      ${JSON.stringify(JSON.stringify({packet:[]}))}::jsonb AS wrapped,${'{"source":"text"}'}::text AS text`;
    expect(row).toEqual({object:{packet:[1,true,null]},array:[1,true,null],scalar:false,wrapped:'{"packet":[]}',text:'{"source":"text"}'});
  });
  it("keeps ordinary supersession valid but missing/altered canonical rows unavailable", async () => {
    const rollback=new Error("controlled identity rollback");
    for(const mode of ["superseded","missing","semantic"]) {
      try { await raw.begin(async native=> {
        const tx = native as unknown as typeof raw;
        if(mode==="superseded") await tx`UPDATE published_fee_corrections SET status='superseded',superseded_at=NOW() WHERE id=${correctionId}`;
        else if(mode==="missing") await tx`DELETE FROM published_fee_corrections WHERE id=${correctionId}`;
        else await tx`UPDATE published_fee_corrections SET reason='Altered immutable label' WHERE id=${correctionId}`;
        const result=await runCorrectiveSource({db:tx as unknown as Db,runId:null,dryRun:false});
        expect(result.evaluated,mode).toBe(mode==="superseded"?1:0); expect(result.regressions).toBe(0);
        throw rollback;
      }); } catch(error) { if(error!==rollback) throw error; }
    }
  });
  it("counts concurrent enrollment only from actual INSERT RETURNING", async () => {
    const c=await anotherCorrection();
    const pool=postgres(connection!,{ssl:"require",max:2,types:{json:JSON_TEXT_PASSTHROUGH,numeric:NUMERIC_AS_NUMBER,text:TEXT_WITHOUT_NUL}});
    try {
      const results=await Promise.all([runCorrectiveSource({db:pool as unknown as Db,runId:null,dryRun:false}),runCorrectiveSource({db:pool as unknown as Db,runId:null,dryRun:false})]);
      expect(results.reduce((n,r)=>n+r.promoted,0)).toBe(1);
      expect(await raw`SELECT id FROM eval_cases WHERE case_key=${`corrective:${c.result.correctionId}:source_snapshot_v2`}`).toHaveLength(1);
    } finally { await pool.end(); await removeCorrection(c); }
  });
  it("rechecks canonical authority after an actual case-lock wait before recording replay success", async () => {
    const c=await anotherCorrection();
    await runCorrectiveSource({db,runId:null,dryRun:false});
    const [row]=await raw`SELECT id,last_checked_at FROM eval_cases WHERE case_key=${`corrective:${c.result.correctionId}:source_snapshot_v2`}`;
    const holder=postgres(connection!,{ssl:"require",max:1});
    const worker=postgres(connection!,{ssl:"require",max:1,connection:{application_name:"corrective-replay-lock-witness"},types:{json:JSON_TEXT_PASSTHROUGH,numeric:NUMERIC_AS_NUMBER,text:TEXT_WITHOUT_NUL}});
    const hold=await holder.reserve(); let committed=false; let pending:ReturnType<typeof runCorrectiveSource>|undefined;
    try {
      await worker`SELECT 1`; await hold`BEGIN`;
      await hold`SELECT id FROM eval_cases WHERE id=${row.id} FOR UPDATE`;
      pending=runCorrectiveSource({db:worker as unknown as Db,runId:null,dryRun:false});
      let observed=false;
      // Admission and replay listings run window by window before the claim; poll by deadline, not count.
      for(const deadline=performance.now()+10000;performance.now()<deadline;) {
        const [wait]=await raw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='corrective-replay-lock-witness' AND wait_event_type='Lock' AND query LIKE '%FROM eval_cases%FOR UPDATE%') AS waiting`;
        if(wait.waiting) {observed=true;break;} await new Promise(resolve=>setTimeout(resolve,2));
      }
      expect(observed,"actual claim wait was reached before changing the receipt").toBe(true);
      await hold`UPDATE published_fee_corrections SET source_check='{}'::jsonb WHERE id=${c.result.correctionId}`;
      await hold`COMMIT`; committed=true;
      const result=await pending; expect(result.evaluated).toBe(1); // original unchanged case only
      const [after]=await raw`SELECT last_checked_at FROM eval_cases WHERE id=${row.id}`;
      expect(after.last_checked_at).toEqual(row.last_checked_at);
    } finally {
      if(!committed) await hold`ROLLBACK`; hold.release();
      if(pending) await pending;
      await holder.end(); await worker.end(); await removeCorrection(c);
    }
  });
  it("keeps unbound source takedowns availability-only and does not let legacy cases crowd the actual replay ceiling", async () => {
    await recordFeedback(db,[{aboutStage:"publish",signal:"wrong",kind:"takedown_confirmed",reportedBy:"hamilton",checkName:"hamilton.source_check",
      institutionId:INST,feePublishedId:oldId,canonicalFeeKey:"stop_payment",amount:25,evidence:{reason:"unreproduced"},dedupeKey:"unbound-source-2064"}]);
    await raw`INSERT INTO eval_cases(case_key,dataset,status,agent,check_name,error_class,severity,input,expected,label_provenance,institution_id)
      SELECT 'legacy-prefix:'||n,'regression','active','hamilton','hamilton.source_check','unknown','major',
        '{"kind":"source_check","texts":[]}'::jsonb,'{}'::jsonb,'takedown_confirmed',${INST} FROM generate_series(1,401)n`;
    const [limit]=await raw`INSERT INTO eval_cases(case_key,dataset,status,agent,check_name,error_class,severity,input,expected,label_provenance,institution_id)
      VALUES('healthy-limit-2064','golden','candidate','hamilton','hamilton.limit_guard','limit_as_fee','major',
      '{"kind":"limit_guard","canonical_fee_key":"od_daily_cap","fee_name":"No Bounce Courtesy Pay Limit","amount":600,"conditions":null}'::jsonb,'{}'::jsonb,'human',${INST}) RETURNING id`;
    try {
      const result=await runDemingRegression({db,runId:null,replayLimit:2});
      expect(result.replayed).toBe(2); expect(result.corrective?.evaluated).toBe(1);
      expect(await raw`SELECT id FROM eval_cases WHERE case_key=${`takedown:${oldId}:hamilton.source_check`}`).toHaveLength(0);
      expect((await raw`SELECT status FROM eval_cases WHERE id=${limit.id}`)[0].status).toBe("active");
      expect((await raw`SELECT count(*)::int AS n FROM eval_cases WHERE case_key LIKE 'legacy-prefix:%' AND last_checked_at IS NOT NULL`)[0].n).toBe(0);
      expect(result.corrective?.unavailable.count).toBeGreaterThanOrEqual(402);
    } finally {
      await raw`DELETE FROM eval_cases WHERE case_key LIKE 'legacy-prefix:%' OR id=${limit.id}`;
      await raw`DELETE FROM pipeline_feedback WHERE dedupe_key='unbound-source-2064'`;
    }
  });
  it("cannot retrofit a committed correction receipt from today's convenient source state", async () => {
    const c=await anotherCorrection();
    try {
      await raw`UPDATE published_fee_corrections SET source_check=source_check-'deming_source_v2' WHERE id=${c.result.correctionId}`;
      const [ast]=await raw`SELECT id FROM agent_source_texts WHERE source_document_id=${DOC}`;
      const [originalStep]=await raw`SELECT id FROM agent_run_steps WHERE agent_run_id=${c.result.runId} AND step_key='admin.fee_correct'`;
      const sealed=await raw.begin(tx=>sealCorrectiveSource(tx as unknown as Db,{correctionId:c.result.correctionId,runId:c.result.runId!,stepId:Number(originalStep.id),
        document:{id:DOC,institutionId:INST,astId:Number(ast.id),astInstitutionId:INST,status:"completed",documentUrl:"https://fixture.invalid/fees",contentHash:"fixture-byte-edition",sourceHash:"fixture-byte-edition",
          textHash:createHash("sha256").update(TEXT).digest("hex"),normalizedText:TEXT}}));
      expect(sealed).toBe(false);
      expect((await raw`SELECT source_check ? 'deming_source_v2' AS present FROM published_fee_corrections WHERE id=${c.result.correctionId}`)[0].present).toBe(false);
    } finally { await removeCorrection(c); }
  });
  it("treats a real failed metadata read as unknown, rolls back its savepoint, and can retry", async () => {
    await raw.begin(async nativeTransaction=> {
      const native = nativeTransaction as unknown as typeof raw;
      let fail=true;
      const wrap=(real:Db):Db=>new Proxy(real,{get(target,key,receiver) {
        if(key==="savepoint") return (fn:(tx:Db)=>Promise<unknown>)=>(target as unknown as {savepoint:(fn:(tx:Db)=>Promise<unknown>)=>Promise<unknown>}).savepoint(sp=>fn(wrap(sp)));
        if(key==="unsafe") return (query:string,params:never[])=> {
          if(fail && query.includes("SELECT id,case_bytes::int,database_digest FROM eligible ORDER BY id LIMIT")) { fail=false; return real`SELECT 1/0`; }
          return real.unsafe(query,params);
        };
        return Reflect.get(target,key,receiver);
      }});
      const failed=await runCorrectiveSource({db:wrap(native as unknown as Db),runId:null,dryRun:false});
      expect(failed).toMatchObject({promoted:0,evaluated:0,caught:0,regressions:0,unavailable:{count:null}});
      expect(failed.warnings).toEqual([expect.objectContaining({phase:"admission_read",count:1,timedOut:false,error:expect.stringContaining("division by zero")})]);
      expect((await native`SELECT 42 AS healthy`)[0].healthy).toBe(42);
      expect((await runCorrectiveSource({db:native as unknown as Db,runId:null,dryRun:false})).evaluated).toBe(1);
    });
  });
  it("reports a real replay-read statement timeout as a visible step warning instead of an empty replay", async () => {
    const c=await anotherCorrection();
    try {
      await runCorrectiveSource({db,runId:null,dryRun:false});
      await raw.begin(async nativeTransaction=> {
        const native = nativeTransaction as unknown as typeof raw;
        const wrap=(real:Db):Db=>new Proxy(real,{get(target,key,receiver) {
          if(key==="savepoint") return (fn:(tx:Db)=>Promise<unknown>)=>(target as unknown as {savepoint:(fn:(tx:Db)=>Promise<unknown>)=>Promise<unknown>}).savepoint(sp=>fn(wrap(sp)));
          if(key==="unsafe") return (query:string,params:never[])=> {
            // A real statement that outlives the unchanged 2 s replay cap, in its real savepoint.
            if(query.includes("SELECT case_id,case_status,case_bytes::int,database_digest FROM due")) return real`SELECT pg_sleep(3)`;
            return real.unsafe(query,params);
          };
          return Reflect.get(target,key,receiver);
        }});
        const result=await runCorrectiveSource({db:wrap(native as unknown as Db),runId:null,dryRun:false});
        expect(result.evaluated).toBe(0);
        expect(result.warnings).toEqual([expect.objectContaining({phase:"replay_read",count:1,timedOut:true})]);
        const [run]=await native`INSERT INTO agent_runs(agent_name,run_kind,title,status) VALUES('atlas','workflow','Replay timeout witness','running') RETURNING id`;
        const [step]=await native`INSERT INTO agent_run_steps(agent_run_id,agent_name,step_key,title,status) VALUES(${run.id},'atlas','deming-regression','Replay timeout witness','running') RETURNING id`;
        await recordCorrectiveWarnings(native as unknown as Db,Number(run.id),Number(step.id),result.warnings);
        const events=await native`SELECT event_type,message,detail->>'check' AS check FROM agent_run_events WHERE agent_run_id=${run.id}`;
        expect(events).toEqual([expect.objectContaining({event_type:"step.warning",check:"admin.fee_correction.source_context.replay_read",message:expect.stringContaining("statement timeout")})]);
        throw new Error("rollback replay timeout witness");
      }).catch((error:unknown)=>{ if(!(error instanceof Error && error.message==="rollback replay timeout witness")) throw error; });
    } finally { await removeCorrection(c); }
  },20000);
  it("admits 300 maximum-codepoint one-document contexts under the unchanged native statement budget and transfers an ordered bounded prefix", async () => {
    const template = await anotherCorrection();
    await runCorrectiveSource({ db, runId: null, dryRun: false });
    const line = "Stop Payment Fee | $35.00";
    const body = "😀".repeat(200000-Array.from(line).length)+line;
    const digest = createHash("sha256").update(body).digest("hex");
    const [ast] = await raw`SELECT id FROM agent_source_texts WHERE source_document_id=${DOC}`;
    const rollback = new Error("controlled maximum-fixture rollback");
    try {
      await raw.begin(async (nativeTransaction) => {
        const native = nativeTransaction as unknown as typeof raw;
        const tx = native as unknown as Db;
        await native`SELECT set_config('statement_timeout','2000',true),set_config('lock_timeout','100',true)`;
        await native`UPDATE agent_source_texts SET normalized_text=${body},text_hash=${digest} WHERE id=${ast.id}`;
        const before = { canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amount: 25, frequency: "per_item", conditions: null };
        const after = { ...before, amount: 35 };
        const ids: number[] = [];
        // Native synthetic metadata fixtures use the real ledger writer/sealer. They are not
        // 300 production corrections or evidence about label accuracy. The genuine action is above.
        for (let i=0;i<300;i++) {
          const version=10000+i;
          const reason="Controlled maximum source fixture";
          const run = await recordAdminFeeRun(tx,{action:"correct",title:"Maximum-context fixture",summary:"Synthetic fixture",actor:{id:1,name:"James"},institutionId:INST,
            detail:{fee_published_id:template.result.previousFeePublishedId,fee_chain_id:template.result.previousFeePublishedId,version,reason,before,after}});
          const [fresh] = await native`INSERT INTO published_fee_records(lineage_ref,institution_id,canonical_fee_key,published_by_adversarial_event_id,fee_name,amount,frequency,batch_id,rolled_back_at)
            VALUES(${template.verifiedId},${INST},'stop_payment',${EVENT},'Stop Payment Fee',35,'per_item','maximum-context-fixture',NOW()) RETURNING fee_published_id`;
          const [c] = await native`INSERT INTO published_fee_corrections(fee_chain_id,version,action,status,superseded_at,institution_id,previous_fee_published_id,fee_published_id,
            before_canonical_fee_key,before_fee_name,before_amount,before_frequency,canonical_fee_key,fee_name,amount,frequency,
            source_document_id,source_excerpt,source_location,reason,actor_user_id,actor_name,idempotency_key,agent_run_id)
            VALUES(${template.result.previousFeePublishedId},${version},'correct','superseded',NOW(),${INST},${template.result.previousFeePublishedId},${fresh.fee_published_id},
              'stop_payment','Stop Payment Fee',25,'per_item','stop_payment','Stop Payment Fee',35,'per_item',${DOC},${line},'row 1',${reason},1,'James',${`max-${template.result.correctionId}-${i}`},${run.runId}) RETURNING id`;
          const correction = Number(c.id); ids.push(correction);
          await recordFeedback(tx,[{aboutStage:"publish",signal:"wrong",kind:"admin_correction",reportedBy:"human",checkName:"admin.fee_correction",institutionId:INST,
            sourceDocumentId:DOC,feePublishedId:template.result.previousFeePublishedId,canonicalFeeKey:"stop_payment",amount:25,runId:run.runId,dedupeKey:`admin.fee_correction:${correction}`,
            evidence:{action:"correct",correction_id:correction,fee_chain_id:template.result.previousFeePublishedId,version,new_fee_published_id:Number(fresh.fee_published_id),actor_id:1,actor:"James",
              reason,before,after,source_excerpt:line,source_location:"row 1",at:new Date().toISOString()}}]);
          expect(await sealCorrectiveSource(tx,{correctionId:correction,runId:run.runId,stepId:run.stepId,document:{id:DOC,institutionId:INST,astId:Number(ast.id),astInstitutionId:INST,
            status:"completed",documentUrl:"https://fixture.invalid/fees",contentHash:"fixture-byte-edition",sourceHash:"fixture-byte-edition",textHash:digest,normalizedText:body}})).toBe(true);
        }
        const metadata=await loadCorrectiveCaseCandidates(tx);
        expect(metadata.map((m)=>m.id)).toEqual(ids);
        expect(metadataSql).toContain("SELECT id,case_bytes");
        const [explain]=await native.unsafe("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+metadataSql,metadataParams as never[]);
        const plan=explain["QUERY PLAN"];
        expect(Array.isArray(plan)).toBe(true); expect(plan[0]["Execution Time"]).toBeLessThan(2000);
        expect(JSON.stringify(metadata)).not.toContain("normalizedText");
        expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThan(100000);
        const [ar]=await native`INSERT INTO agent_runs(agent_name,run_kind,title,status) VALUES('atlas','workflow','Bounded fixture artifact','running') RETURNING id`;
        const [artifactStep]=await native`INSERT INTO agent_run_steps(agent_run_id,agent_name,step_key,title,status) VALUES(${ar.id},'atlas','deming-regression','Actual bounded replay','running') RETURNING id`;
        const result=await runCorrectiveSource({db:tx,runId:Number(ar.id),dryRun:false});
        expect(result.admissionLimitReached).toBe(true);
        expect(result.promoted).toBeGreaterThan(0); expect(result.promoted).toBeLessThan(300);
        expect(result.deferred).toBe(300-result.promoted);
        const inserted=await native`SELECT input->'receipt'->'payload'->'canonical'->>'id' AS correction_id,octet_length(input::text) AS bytes
          FROM eval_cases WHERE case_key LIKE 'corrective:%' AND (input->'receipt'->'payload'->'canonical'->>'id')=ANY(${ids.map(String)}::text[]) ORDER BY id`;
        expect(inserted.map((r)=>Number(r.correction_id))).toEqual(ids.slice(0,result.promoted));
        const insertedBytes=inserted.reduce((n,r)=>n+Number(r.bytes),0);
        expect(insertedBytes).toBeLessThanOrEqual(8*1024*1024);
        expect(result.warnings.filter((w)=>w.phase!=="unavailable_census"),"admission, enrollment and replay finish inside the 2 s cap").toEqual([]);
        expect(result.artifact.chunks.length).toBeGreaterThan(1);
        await native`CREATE FUNCTION pg_temp.reject_second_fixture_chunk() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
          IF NEW.event_type='deming.fixture.v2' AND NEW.detail->>'index'='1' THEN RAISE EXCEPTION 'controlled second artifact chunk failure'; END IF; RETURN NEW; END$$`;
        await native`CREATE TRIGGER corrective_chunk_failure BEFORE INSERT ON agent_run_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_second_fixture_chunk()`;
        expect(await persistCorrectiveArtifact(tx,Number(ar.id),Number(artifactStep.id),result.artifact)).toMatchObject({state:"unavailable",chunks:0,cases:0});
        expect(await native`SELECT id FROM agent_run_events WHERE agent_run_id=${ar.id} AND event_type='deming.fixture.v2'`).toHaveLength(0);
        await native`DROP TRIGGER corrective_chunk_failure ON agent_run_events`;
        expect(await persistCorrectiveArtifact(tx,Number(ar.id),Number(artifactStep.id),result.artifact)).toMatchObject({state:"stored",cases:result.artifact.caseCount});
        expect(await persistCorrectiveArtifact(tx,Number(ar.id),Number(artifactStep.id),result.artifact)).toMatchObject({state:"stored"});
        expect(await native`SELECT id FROM agent_run_events WHERE agent_run_id=${ar.id} AND event_type='deming.fixture.v2'`).toHaveLength(result.artifact.chunks.length);
        throw rollback;
      });
    } catch (error) { if(error!==rollback) throw error; }
    finally { await removeCorrection(template); }
  },60000);

});

// #2414 review: replay pages member cases by key, not OFFSET. A case rechecked between two windows
// moves to the end of the order; with OFFSET counted across statements the next window then
// skipped as many unseen cases as had moved. Keys keep Postgres's microseconds through the page.
describe.skipIf(!connection)("corrective replay member paging in actual PostgreSQL", () => {
  let raw: postgres.Sql;
  const PREFIX = "corrective:paging-";
  beforeAll(async () => { raw = postgres(connection!, { max: 1, onnotice: () => {} }); });
  afterAll(async () => { await raw`DELETE FROM eval_cases WHERE case_key LIKE ${`${PREFIX}%`}`; await raw.end(); });

  it("sees every member once in order when keys tie to the microsecond, and none is skipped when earlier ones are rechecked mid-page", async () => {
    await raw`DELETE FROM eval_cases WHERE case_key LIKE ${`${PREFIX}%`}`;
    const tied = "2026-10-01 12:00:00.123456+00";
    const rows = await raw`INSERT INTO eval_cases(case_key,dataset,status,agent,check_name,error_class,severity,input,expected,label_provenance,last_checked_at)
      SELECT ${PREFIX}||g::text||':source_snapshot_v2','regression','active','hamilton',${correctivePolicy.CORRECTIVE_CHECK},'unknown','major','{}'::jsonb,'{}'::jsonb,'human',
        CASE WHEN g<=30 THEN NULL ELSE ${tied}::timestamptz END
      FROM generate_series(1,130) g RETURNING id`;
    const all = new Set(rows.map((r) => String(r.id)));
    const ours = (window: CorrectiveMemberKey[]) => window.filter((key) => all.has(key.id));

    const ordered: string[] = [];
    let after: CorrectiveMemberKey = { ts: null, id: "0" };
    // 130 members fit in 3 windows of 50; a cursor that stalls fails here instead of timing out.
    for (let pages = 0; ; pages++) {
      expect(pages).toBeLessThan(10);
      const window = await correctiveMemberWindow(raw as never, after);
      if (window.length === 0) break;
      ordered.push(...ours(window).map((key) => key.id));
      after = window.at(-1)!;
    }
    expect(ordered).toHaveLength(130);
    expect(new Set(ordered).size).toBe(130);

    const seen = new Set<string>();
    after = { ts: null, id: "0" };
    let first = true;
    for (let pages = 0; ; pages++) {
      expect(pages).toBeLessThan(10);
      const window = await correctiveMemberWindow(raw as never, after);
      if (window.length === 0) break;
      for (const key of ours(window)) seen.add(key.id);
      if (first) {
        // Another run rechecks the first window's cases before this run reads the next window.
        await raw`UPDATE eval_cases SET last_checked_at=NOW() WHERE id = ANY(${window.map((key) => key.id)}::bigint[])`;
        first = false;
      }
      after = window.at(-1)!;
    }
    expect([...all].filter((id) => !seen.has(id))).toEqual([]);
  });
});
