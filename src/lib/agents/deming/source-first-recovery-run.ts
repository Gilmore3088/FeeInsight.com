/**
 * Existing Deming step's read-only companion for independently confirmed missing fees.
 *
 * Uses existing pipeline_feedback as an intake ledger; DO NOT treat generic
 * `missed` signals, held extraction rows or source-check self-agreement as
 * official current-source obligations. No migration or source write required.
 * No rows are silently seeded into production and no reprocess is triggered.
 */
import type { sql } from "@/lib/data-store/connection";
import {compileRecoveryPlan, type FeeObligation, type RecoveryBatchPlan} from "./source-first-recovery";
import {readSourceFirstLineage} from "./source-first-recovery-db";

type SqlTag=typeof sql;
export const SOURCE_FIRST_LEDGER_FORMAT="source_first_obligation.v1";
export const SOURCE_FIRST_READ_LIMIT=25;
interface IntakeRow {id:number|string; institution_id:number|string; evidence:unknown;}
export interface SourceFirstRecoveryRead {
  sourceFirstFormat:typeof SOURCE_FIRST_LEDGER_FORMAT;
  enrolled:number;
  rejected:number;
  unreadable:number;
  warnings:string[];
  result:RecoveryBatchPlan;
}
function object(value:unknown):Record<string,unknown>|null {
  if(value && typeof value==="object" && !Array.isArray(value))return value as Record<string,unknown>;
  if(typeof value==="string") {try{return object(JSON.parse(value))}catch{return null}}
  return null;
}
export function decodeOfficialObligation(row:IntakeRow):FeeObligation|null {
  const evidence=object(row.evidence);
  if(!evidence || evidence.format!==SOURCE_FIRST_LEDGER_FORMAT)return null;
  const caseObj=object(evidence.obligation);
  if(!caseObj || !Number.isSafeInteger(Number(row.institution_id)) || !Number.isSafeInteger(Number(row.id)))return null;
  const caseId=caseObj.caseId;
  // Bank ID is authoritative from the intake row, not an arbitrary JSON override.
  if(typeof caseId!=="string" || !caseId.trim())return null;
  if(caseObj.institutionId != null && Number(caseObj.institutionId)!==Number(row.institution_id))return null;
  return {...caseObj,institutionId:Number(row.institution_id)} as unknown as FeeObligation;
}
/** READS only. Every case result stays explicitly unproven until independently adjudicated. */
export async function runSourceFirstRecoveryRead(db:SqlTag,limit=SOURCE_FIRST_READ_LIMIT):Promise<SourceFirstRecoveryRead> {
  const safeLimit=Math.max(1,Math.min(SOURCE_FIRST_READ_LIMIT,Math.floor(limit)));
  const rows=await db<IntakeRow[]>`
    SELECT id,institution_id,evidence FROM pipeline_feedback
     WHERE signal='missed' AND kind='official_source_omission'
       AND reported_by='human' AND evidence->>'format'=${SOURCE_FIRST_LEDGER_FORMAT}
     ORDER BY id ASC LIMIT ${safeLimit+1}
  `;
  const rejected: string[]=[];
  if(rows.length>safeLimit)rejected.push("source_first_intake_over_limit_incomplete_frame");
  const observations:Array<{obligation:FeeObligation;lineage:Awaited<ReturnType<typeof readSourceFirstLineage>>["lineage"]}>=[];
  for(const row of rows.slice(0,safeLimit)){
    const item=decodeOfficialObligation(row);
    if(!item){rejected.push(`invalid_source_first_ledger:${row.id}`);continue;}
    try {
      const next=await readSourceFirstLineage(db,item);
      rejected.push(...next.warnings.map(w=>`${item.caseId}:${w}`));
      observations.push({obligation:item,lineage:next.lineage});
    }catch(error){rejected.push(`read_failure:${row.id}:${error instanceof Error?error.message:String(error)}`);}
  }
  let plan:RecoveryBatchPlan;
  try{plan=compileRecoveryPlan(observations);}catch(err){
    rejected.push(`source_first_identity_conflict:${err instanceof Error?err.message:String(err)}`);
    plan=compileRecoveryPlan([]);
  }
  return {sourceFirstFormat:SOURCE_FIRST_LEDGER_FORMAT,enrolled:observations.length,rejected:rejected.length,
    unreadable:rows.length-observations.length,warnings:rejected,result:plan};
}

export function sourceFirstRecoverySummary(read:SourceFirstRecoveryRead):string {
  return `${read.enrolled} independently entered source-first missing-fee cases examined: `+
    `${read.result.sourceFirstSuccessCount} customer-surface verified, `+
    `${read.result.pendingOrUnprovenCount} unresolved, ${read.rejected} intake/lineage limitations. `+
    `No fee mutation or production re-run was performed.`;
}