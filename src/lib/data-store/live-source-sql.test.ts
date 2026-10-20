// @vitest-environment node
import postgres from "postgres";
import { describe,it,expect,vi } from "vitest";
import { inLiveAuditTransaction,withLiveAuditReceiptPhase,LiveAuditSqlBudgetError } from "./live-source-sql";
import { NUMERIC_AS_NUMBER,JSON_TEXT_PASSTHROUGH,TEXT_WITHOUT_NUL } from "./connection";

type DB=Parameters<typeof inLiveAuditTransaction>[0];
function fixture(options:{stallStartup?:boolean;delay?:number;rollbackFails?:boolean;commitDelay?:number;ignoreCommitCancel?:boolean}={}){
  const configured=postgres({host:"127.0.0.1",port:9,database:"owned_fixture",user:"fixture",password:"fixture-only",ssl:false,
    connection:{search_path:"isolated_fixture,public",role:"fixture_role"},types:{numeric:NUMERIC_AS_NUMBER,json:JSON_TEXT_PASSTHROUGH,text:TEXT_WITHOUT_NUL}});
  const commands:string[]=[],active=new Set<{reject:(error:Error)=>void}>();let closed=false,cancelled=0;
  const raw=((strings:TemplateStringsArray)=>{
    const command=strings.join("?");commands.push(command);
    let reject!:(error:Error)=>void;
    const promise=new Promise<unknown>((resolve,fail)=>{
      reject=fail;
      if(options.stallStartup&&command==="SELECT 1")return;
      if(options.rollbackFails&&command==="ROLLBACK"){fail(new Error("rollback fixture failure"));return;}
      const delay=command==="COMMIT"?options.commitDelay??0:command.includes("fixture_work")?options.delay??0:0;
      setTimeout(()=>closed?fail(new Error("closed")):resolve([]),delay);
    });
    const pending={reject};active.add(pending);
    void promise.then(()=>active.delete(pending),()=>active.delete(pending));
    return Object.assign(promise,{cancel:()=>{cancelled++;if(!(options.ignoreCommitCancel&&command==="COMMIT"))reject(new Error("cancelled"));return Promise.resolve();}});
  }) as unknown as DB;
  raw.end=vi.fn(async()=>{closed=true;for(const pending of active)pending.reject(new Error("closed"));}) as DB["end"];
  const factory=vi.fn((options:unknown)=>{if(!options)throw new Error("fixture_options_required");return raw;});
  return {db:configured as unknown as DB,raw,commands,factory,get closed(){return closed;},get cancelled(){return cancelled;}};
}

describe("owned live-audit receipt SQL deadline",()=>{
  it("fails closed before creating a client for absent or unusable supplied options",async()=>{
    const factory=vi.fn(),valid=fixture().db;
    const multi={options:{...valid.options,host:["127.0.0.1","127.0.0.2"]}} as unknown as DB;
    const custom={options:{...valid.options,socket:()=>{throw new Error("must not be called");}}} as unknown as DB;
    for(const db of [multi,custom,(()=>{}) as unknown as DB,{options:{host:["127.0.0.1"],port:[],database:"fixture",user:"fixture",ssl:false,types:{}}} as unknown as DB]){
      await expect(withLiveAuditReceiptPhase(db,Date.now()+200,async()=>1,{clientFactory:factory})).rejects.toThrow("live_audit_requires_configured_client");
    }
    expect(factory).not.toHaveBeenCalled();
  });
  it("clones exactly supplied connection, TLS, role, search path and type semantics",async()=>{
    const f=fixture();
    await withLiveAuditReceiptPhase(f.db,Date.now()+500,db=>inLiveAuditTransaction(db,async tx=>{await tx`SELECT fixture_work`;return 7;}),{clientFactory:f.factory});
    const passed=f.factory.mock.calls[0]![0] as unknown as Record<string,unknown>,original=f.db.options as unknown as Record<string,unknown>;
    for(const name of ["host","port","database","user","pass","ssl","connection","types","transform","serializers","parsers","prepare"]){expect(passed[name]).toEqual(original[name]);}
    expect(passed.max).toBe(1);expect(passed.connect_timeout).toBeLessThanOrEqual(1);
    expect(f.commands.filter(x=>x==="BEGIN")).toHaveLength(1);expect(f.commands).toContain("COMMIT");expect(f.closed).toBe(true);
  });
  it("cancels stalled startup before BEGIN and closes its owned client",async()=>{
    const f=fixture({stallStartup:true}),work=vi.fn(),at=Date.now();
    await expect(withLiveAuditReceiptPhase(f.db,at+120,work,{clientFactory:f.factory})).rejects.toThrow();
    expect(Date.now()-at).toBeLessThan(700);expect(work).not.toHaveBeenCalled();expect(f.commands).not.toContain("BEGIN");expect(f.cancelled).toBe(0);expect(f.closed).toBe(true);
  });
  it("uses one cumulative deadline across statements and awaits rollback and shutdown",async()=>{
    const f=fixture({delay:55}),at=Date.now();
    await expect(withLiveAuditReceiptPhase(f.db,at+150,db=>inLiveAuditTransaction(db,async tx=>{
      await tx`SELECT fixture_work`;await tx`SELECT fixture_work`;await tx`SELECT fixture_work`;
    }),{clientFactory:f.factory})).rejects.toThrow();
    expect(Date.now()-at).toBeLessThan(700);expect(f.cancelled).toBe(0);expect(f.commands).not.toContain("COMMIT");expect(f.closed).toBe(true);
  });
  it("reports unknown commit outcome when acknowledgement arrives after cancellation",async()=>{
    const f=fixture({commitDelay:125,ignoreCommitCancel:true});
    const promise=withLiveAuditReceiptPhase(f.db,Date.now()+150,db=>inLiveAuditTransaction(db,async()=>7),{clientFactory:f.factory});
    await expect(promise).rejects.toMatchObject({name:"LiveAuditSqlBudgetError",commitOutcome:"unknown"});
    expect(f.commands).toContain("COMMIT");expect(f.closed).toBe(true);
  });
  it("still shuts down when rollback itself fails",async()=>{
    const f=fixture({rollbackFails:true});
    await expect(withLiveAuditReceiptPhase(f.db,Date.now()+300,db=>inLiveAuditTransaction(db,async()=>{throw new Error("fixture failure");}),{clientFactory:f.factory})).rejects.toThrow("fixture failure");
    expect(f.commands).toContain("ROLLBACK");expect(f.closed).toBe(true);
  });
  it("closes at the hard deadline and rejects a callback's attempted late write",async()=>{
    const f=fixture();let release!:()=>void,late:Promise<unknown>|undefined;
    const held=new Promise<void>(done=>{release=done;});
    await expect(withLiveAuditReceiptPhase(f.db,Date.now()+100,async db=>{await held;late=inLiveAuditTransaction(db,tx=>tx`INSERT INTO fixture_work VALUES(1)`);await late;},{clientFactory:f.factory})).rejects.toBeInstanceOf(LiveAuditSqlBudgetError);
    expect(f.closed).toBe(true);release();await vi.waitFor(()=>expect(late).toBeDefined());await expect(late).rejects.toBeInstanceOf(LiveAuditSqlBudgetError);
    expect(f.commands.some(x=>x.startsWith("INSERT"))).toBe(false);
  });
});
