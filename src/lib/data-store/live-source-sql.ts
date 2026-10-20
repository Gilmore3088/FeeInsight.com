import postgres from "postgres";
import type { sql } from "./connection";

type DB=typeof sql;
interface Phase {raw:DB;workUntil:number;closed:boolean;transaction:boolean;committing:boolean;shutdown:()=>Promise<void>}
const phases=new WeakMap<object,Phase>();
export class LiveAuditSqlBudgetError extends Error {
  constructor(readonly commitOutcome:"not_attempted"|"unknown"="not_attempted"){
    super(commitOutcome==="unknown"?"live_audit_commit_outcome_unknown: receipt completion unavailable":"live_audit_sql_budget_exhausted: receipt completion unavailable");this.name="LiveAuditSqlBudgetError";
  }
}
const ensure=(phase:Phase)=>{if(phase.closed||Date.now()>=phase.workUntil)throw new LiveAuditSqlBudgetError(phase.committing?"unknown":"not_attempted");};
async function execute(phase:Phase,make:()=>PromiseLike<unknown>):Promise<unknown>{
  ensure(phase);if(!phase.transaction)throw new Error("live_audit_receipt_transaction_required");
  // Transaction-local limits bound ordinary backend statements if client shutdown
  // acknowledgement is lost. Already-sent COMMIT is explicitly uncertain.
  const remaining=Math.max(1,phase.workUntil-Date.now());
  await phase.raw`SELECT set_config('statement_timeout',${String(remaining)},true),set_config('lock_timeout',${String(remaining)},true)`;
  ensure(phase);return make();
}
function tag(phase:Phase):DB{
  const wrapped=new Proxy(phase.raw,{
    apply(target,_this,args){return execute(phase,()=>Reflect.apply(target,target,args) as PromiseLike<unknown>);},
    get(target,key){
      if(key==="unsafe")return (...args:unknown[])=>execute(phase,()=>Reflect.apply(target.unsafe,target,args) as PromiseLike<unknown>);
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    },
  });
  phases.set(wrapped,phase);return wrapped;
}

/** One short-lived, owned native client for this diagnostic's receipt phase, never across HTTP.
 * Full-query tags only, not a generic SQL/fragment adapter. No shared/global fallback.
 */
export async function withLiveAuditReceiptPhase<T>(db:DB,deadline:number,work:(scope:DB)=>Promise<T>,options?:{
  clientFactory?:(options:postgres.Options<Record<string,postgres.PostgresType>>)=>DB;
}):Promise<T>{
  const existing=phases.get(db);if(existing){ensure(existing);return work(db);}
  const configured=db?.options;
  // Parsed native options are required: rebuilding from partial options would silently
  // inherit process/global credentials or lose the supplied role/schema/type semantics.
  if(!configured||!Array.isArray(configured.host)||configured.host.length!==1||configured.host.some(host=>typeof host!=="string"||!host)
    ||!Array.isArray(configured.port)||configured.port.length!==1||configured.port.some(port=>!Number.isInteger(port)||port<1||port>65535)
    ||typeof configured.database!=="string"||!configured.database||typeof configured.user!=="string"||!configured.user
    ||configured.ssl===undefined||!configured.types||typeof configured.types!=="object"
    ||(configured as unknown as Record<string,unknown>).socket||!(configured as unknown as Record<string,unknown>).shared
    ||!configured.connection||!configured.transform)throw new Error("live_audit_requires_configured_client");
  const budget=deadline-Date.now();if(budget<50)throw new LiveAuditSqlBudgetError();
  const cleanup=Math.min(2000,Math.max(20,Math.floor(budget/5)));
  const ownedOptions={...configured,max:1,connect_timeout:Math.min(1,cleanup/2000)};
  const raw=(options?.clientFactory??((value)=>postgres(value) as unknown as DB))(ownedOptions as unknown as postgres.Options<Record<string,postgres.PostgresType>>);
  let closing:Promise<void>|undefined;
  const phase:Phase={raw,workUntil:deadline-cleanup,closed:false,transaction:false,committing:false,
    shutdown:()=>closing??=(async()=>{await raw.end({timeout:0});})()};
  const scope=tag(phase);let rejectHard!:(error:Error)=>void;
  const hardFailure=new Promise<never>((_,reject)=>{rejectHard=reject;});
  const revoke=()=>{phase.closed=true;return phase.shutdown();};
  // PendingQuery.cancel() opens a separate driver-owned cancel connection and its
  // public API discards the acknowledgement promise. Terminate this exclusively
  // owned client instead, so there is no auxiliary channel to leak or affect later work.
  const soft=setTimeout(()=>{void revoke().catch(()=>undefined);},Math.max(1,phase.workUntil-Date.now()));
  const hard=setTimeout(()=>{void revoke().then(()=>rejectHard(new LiveAuditSqlBudgetError(phase.committing?"unknown":"not_attempted")),
    ()=>rejectHard(new LiveAuditSqlBudgetError(phase.committing?"unknown":"not_attempted")));},Math.max(1,deadline-Date.now()));
  try{
    const operation=(async()=>{await raw`SELECT 1`;ensure(phase);return work(scope);})();
    return await Promise.race([operation,hardFailure]);
  }finally{
    phase.closed=true;clearTimeout(soft);clearTimeout(hard);
    // end({timeout:0}) prevents queued work/reconnect and terminates this client alone.
    // An uncertain COMMIT is never reported as success or as a proven rollback.
    await phase.shutdown();
  }
}

/** Nested helpers share the same transaction/deadline; no HTTP or external await here. */
export async function inLiveAuditTransaction<T>(db:DB,work:(scope:DB)=>Promise<T>,deadline=Date.now()+10_000):Promise<T>{
  const phase=phases.get(db);
  if(!phase)return withLiveAuditReceiptPhase(db,deadline,scope=>inLiveAuditTransaction(scope,work,deadline));
  ensure(phase);if(phase.transaction)return work(db);
  await phase.raw`BEGIN`;phase.transaction=true;
  try{
    const result=await work(db);ensure(phase);
    phase.committing=true;await execute(phase,()=>phase.raw`COMMIT`);ensure(phase);phase.committing=false;return result;
  }catch(error){
    if(!phase.closed){try{await execute(phase,()=>phase.raw`ROLLBACK`);}catch{/* owned shutdown aborts the connection */}}
    throw phase.closed||error instanceof LiveAuditSqlBudgetError?new LiveAuditSqlBudgetError(phase.committing?"unknown":"not_attempted"):error;
  }finally{phase.transaction=false;phase.committing=false;}
}
