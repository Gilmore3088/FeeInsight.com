// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StripeEventEffects } from "@/lib/stripe-webhook";
const ctx=vi.hoisted(()=>({ db:null as unknown, configured:true, send:vi.fn() }));
vi.mock("@/lib/data-store/connection",async(importOriginal)=>{
  const original=await importOriginal<typeof import("@/lib/data-store/connection")>();
  return {...original,sql:(...args:unknown[])=>(ctx.db as (...args:unknown[])=>unknown)(...args),
    withTransaction:(fn:(tx:unknown)=>Promise<unknown>)=>(ctx.db as {begin:(fn:(tx:unknown)=>Promise<unknown>)=>unknown}).begin(fn)};
});
vi.mock("@/lib/email/resend",async(importOriginal)=>({
  ...await importOriginal<typeof import("@/lib/email/resend")>(),getResendApiKey:()=>ctx.configured?"test-double-only":"",sendResendEmail:ctx.send,
}));
import { JSON_TEXT_PASSTHROUGH, type sql as appSql } from "@/lib/data-store/connection";
import { stagePaymentEmails, drainPaymentEmails, paymentEmailStatus } from "./payment-delivery";
import { claimPaymentEmail, finishPaymentEmail, resolvePaymentEmail } from "@/lib/data-store/payment-outbox";
const url=process.env.PAYMENT_DELIVERY_TEST_DATABASE_URL;
const suite=url?describe:describe.skip;
let db:ReturnType<typeof postgres>;
const provider=new Map<string,string>();
const effects=(more:Partial<StripeEventEffects>={}):StripeEventEffects=>({welcome:[],reportPaid:[],reportDuplicate:[],reportRefunded:[],...more});
async function stage(data:StripeEventEffects,event="evt_outbox"){
  await db.begin(async(tx)=>{
    await tx.unsafe("INSERT INTO stripe_events(stripe_event_id,event_type) VALUES ($1,'fixture') ON CONFLICT DO NOTHING",[event]);
    await stagePaymentEmails(tx as unknown as typeof appSql,event,data);
  });
}
const welcome=()=>effects({welcome:[{email:"recipient@example.invalid",name:"Fixture"}]});
suite("payment delivery with real PostgreSQL and a fake email provider",()=>{
  beforeAll(async()=>{
    const parsed=new URL(url!);
    if(!["127.0.0.1","localhost","[::1]"].includes(parsed.hostname)||!parsed.pathname.startsWith("/feeinsight_billing_test_outbox")) throw new Error("Requires a disposable local outbox database");
    db=postgres(url!,{max:16,prepare:false,types:{json:JSON_TEXT_PASSTHROUGH}});ctx.db=db;
    await db.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      END $$;`);
    await db.unsafe(`CREATE TABLE IF NOT EXISTS users(id bigint PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS leads(id bigint PRIMARY KEY,paid_at timestamptz,refunded_at timestamptz,status text);
      CREATE TABLE IF NOT EXISTS institution_sources(id bigint PRIMARY KEY,institution_name text);
      CREATE TABLE IF NOT EXISTS stripe_events(id bigserial PRIMARY KEY,stripe_event_id text UNIQUE,event_type text);
      DROP TABLE IF EXISTS payment_email_outbox;`);
    await db.unsafe(readFileSync(resolve("supabase/migrations/20270110000043_payment_email_outbox.sql"),"utf8"));
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM","Fee Insight <test@example.invalid>");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM","Fee Insight <test@example.invalid>");
    vi.stubEnv("CUSTOM_REPORT_LINK_SECRET","synthetic-test-signing-value-not-a-real-secret");
  });
  beforeEach(async()=>{
    await db`TRUNCATE payment_email_outbox,stripe_events,leads,users,institution_sources CASCADE`;
    await db`INSERT INTO users(id) VALUES(7)`;
    await db`INSERT INTO leads(id,paid_at,status) VALUES(1,now(),'paid')`;
    await db`INSERT INTO institution_sources(id,institution_name) VALUES(99,'Fixture Bank')`;
    provider.clear();ctx.configured=true;ctx.send.mockReset();
    ctx.send.mockImplementation(async(message:{idempotencyKey:string})=>{
      if(!provider.has(message.idempotencyKey))provider.set(message.idempotencyKey,`receipt_${provider.size+1}`);
      return {status:"sent",providerId:provider.get(message.idempotencyKey)};
    });
  });
  afterAll(async()=>{vi.unstubAllEnvs();if(db)await db.end();});

  it("commits event and obligation atomically and sends nothing before commit",async()=>{
    await expect(db.begin(async(tx)=>{
      await tx.unsafe("INSERT INTO stripe_events(stripe_event_id,event_type) VALUES ('evt_failed','fixture')");
      await stagePaymentEmails(tx as unknown as typeof appSql,"evt_failed",welcome());
      throw new Error("rollback payment");
    })).rejects.toThrow("rollback");
    expect(await db`SELECT * FROM stripe_events`).toHaveLength(0);
    expect(await db`SELECT * FROM payment_email_outbox`).toHaveLength(0);expect(ctx.send).not.toHaveBeenCalled();
    await stage(welcome());expect(await db`SELECT * FROM payment_email_outbox`).toHaveLength(1);expect(ctx.send).not.toHaveBeenCalled();
  });
  it("recovers after the process stopped immediately after payment commit",async()=>{
    await stage(welcome());await drainPaymentEmails("evt_outbox");
    expect((await db`SELECT state FROM payment_email_outbox`)[0].state).toBe("accepted");expect(provider.size).toBe(1);
    await drainPaymentEmails("evt_outbox");expect(ctx.send).toHaveBeenCalledTimes(1);
  });
  it("reclaims an expired lease with the same envelope after provider acceptance but lost receipt",async()=>{
    await stage(welcome());const first=(await claimPaymentEmail("evt_outbox",null,"test@example.invalid"))!;
    await ctx.send(first.message); // provider accepted; deliberately do not record a receipt
    await db`UPDATE payment_email_outbox SET lease_until=now()-interval '1 second'`;
    await drainPaymentEmails("evt_outbox");
    expect(ctx.send).toHaveBeenCalledTimes(2);expect(ctx.send.mock.calls[1][0]).toEqual(ctx.send.mock.calls[0][0]);expect(provider.size).toBe(1);
    expect(await finishPaymentEmail(first,{providerId:"stale_worker_receipt"})).toBe(false);
    expect((await db`SELECT provider_id FROM payment_email_outbox`)[0].provider_id).not.toBe("stale_worker_receipt");
  });
  it("allows only one of sixteen concurrent workers to claim the same email",async()=>{
    await stage(welcome());await Promise.all(Array.from({length:16},()=>drainPaymentEmails("evt_outbox")));
    expect(ctx.send).toHaveBeenCalledTimes(1);expect(provider.size).toBe(1);
  });
  it("persists each recipient separately so successful delivery does not repeat",async()=>{
    await stage(effects({welcome:[{email:"one@example.invalid",name:"One"},{email:"two@example.invalid",name:"Two"}]}));
    ctx.send.mockImplementationOnce(async()=>({status:"failed",error:"temporary failure"}));
    await drainPaymentEmails("evt_outbox");
    expect(await paymentEmailStatus("evt_outbox")).toEqual({pending:1,review:0});
    const [accepted]=await db`SELECT id FROM payment_email_outbox WHERE state='accepted'`;
    await db`UPDATE payment_email_outbox SET next_attempt_at=now() WHERE state='pending'`;
    await drainPaymentEmails("evt_outbox");expect(ctx.send).toHaveBeenCalledTimes(3);
    expect((await db`SELECT attempts FROM payment_email_outbox WHERE id=${accepted.id}`)[0].attempts).toBe(1);
  });
  it("does not consume attempts while email configuration is unavailable",async()=>{
    await stage(welcome());ctx.configured=false;await drainPaymentEmails("evt_outbox");
    const [row]=await db`SELECT attempts,state FROM payment_email_outbox`;expect(row.attempts).toBe(0);expect(row.state).toBe("pending");expect(ctx.send).not.toHaveBeenCalled();
    ctx.configured=true;await db`UPDATE payment_email_outbox SET next_attempt_at=now()`;await drainPaymentEmails("evt_outbox");expect(provider.size).toBe(1);
  });
  it("stops rather than resending after the guaranteed deduplication window",async()=>{
    await stage(welcome());await claimPaymentEmail("evt_outbox",null,"test@example.invalid");
    await db`UPDATE payment_email_outbox SET lease_until=now()-interval '1 second',first_attempt_at=now()-interval '24 hours'`;
    await drainPaymentEmails("evt_outbox");expect(await paymentEmailStatus("evt_outbox")).toEqual({pending:0,review:1});expect(ctx.send).not.toHaveBeenCalled();
  });
  it("caps failed attempts and records manual resolution without resending",async()=>{
    await stage(welcome());await db`UPDATE payment_email_outbox SET attempts=5,first_attempt_at=now()`;
    ctx.send.mockResolvedValue({status:"failed",error:"still unavailable"});await drainPaymentEmails("evt_outbox");
    const [row]=await db`SELECT * FROM payment_email_outbox`;expect(row.attempts).toBe(6);expect(row.state).toBe("review");
    await resolvePaymentEmail(row.id,7,"Verified provider history and fulfilled manually");
    const [resolved]=await db`SELECT * FROM payment_email_outbox`;expect(resolved.state).toBe("resolved");expect(Number(resolved.resolved_by)).toBe(7);
    await drainPaymentEmails("evt_outbox",row.id);expect(ctx.send).toHaveBeenCalledTimes(1);
  });
  it("deduplicates repeated staging and cancels refunded customer deliveries",async()=>{
    const data=effects({reportPaid:[{leadId:1,institutionId:99,name:"Fixture",email:"buyer@example.invalid",cents:30000,checkoutSessionId:"cs_fixture"}]});
    await stage(data);await stage(data);expect(await db`SELECT id FROM payment_email_outbox`).toHaveLength(2);
    await db`UPDATE leads SET refunded_at=now() WHERE id=1`;
    await drainPaymentEmails("evt_outbox");await drainPaymentEmails("evt_outbox");
    const [customer]=await db`SELECT state FROM payment_email_outbox WHERE kind='report_customer'`;expect(customer.state).toBe("cancelled");
    expect(ctx.send.mock.calls.every(([message])=>message.to!=="buyer@example.invalid")).toBe(true);
  });
  it("does not send a report-ready claim when no report link can be generated",async()=>{
    const secret=process.env.CUSTOM_REPORT_LINK_SECRET;delete process.env.CUSTOM_REPORT_LINK_SECRET;
    try{await stage(effects({reportPaid:[{leadId:1,institutionId:99,name:"Fixture",email:"buyer@example.invalid",cents:30000,checkoutSessionId:"cs_fixture"}]}));}
    finally{process.env.CUSTOM_REPORT_LINK_SECRET=secret;}
    const [customer]=await db`SELECT state FROM payment_email_outbox WHERE kind='report_customer'`;expect(customer.state).toBe("review");
    expect((await db`SELECT status FROM leads WHERE id=1`)[0].status).toBe("needs_reply");
  });
  it("denies public access to stored email content and private links",async()=>{
    await stage(welcome());for(const role of ["anon","authenticated"]){
      await expect(db.begin(async(tx)=>{await tx.unsafe(`SET LOCAL ROLE ${role}`);await tx.unsafe("SELECT message FROM payment_email_outbox");})).rejects.toMatchObject({code:"42501"});
    }
  });
});
