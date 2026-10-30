import type { sql } from "@/lib/data-store/connection";
import { queryData } from "@/lib/data-catalog/query-data";
import { coldInstitutionSeries, readColdCallRows, type ColdFileRef } from "@/lib/data-catalog/cold-reads";
import { CALL_PERIOD_PRUNE_MANIFEST } from "./call-period-prune";
import { getInstitutionCallItemHistory } from "@/lib/data-store/institution-quarterly";
import { readNcuaCallSeries } from "@/lib/data-catalog/ncua-call-series";

/** One committed archive per ledger step, through Hamilton's actual shared historical query. */
export async function verifyNextArchivedCallRead(db: typeof sql, target?: { source: string; period: string }, beforePrune = false) {
  const receiptKey = beforePrune ? "storage_preprune_acceptance" : "storage_read_acceptance";
  const files=await db<Array<{source:string;period:string;object_key:string;row_count:string;sha256:string}>>`
    SELECT f.source,f.period,f.object_key,f.row_count,f.sha256 FROM public_data_cold_files f
     WHERE f.table_name='institution_call_report_items' AND (${beforePrune} OR f.pruned_at IS NOT NULL) AND f.verified_at IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM agent_run_events e JOIN agent_run_steps s ON s.id=e.step_id
         WHERE s.step_key='atlas-storage-retention' AND e.event_type='step.finished' AND e.status='completed'
           AND e.detail->${receiptKey}->>'source'=f.source
           AND e.detail->${receiptKey}->>'period'=f.period
           AND e.detail->${receiptKey}->>'sha256'=f.sha256
           AND e.detail->${receiptKey}->>'status'='verified')
     ORDER BY f.source,f.period
  `;
  const file=files.find((f)=>(!target||(f.source===target.source&&f.period===target.period))&&CALL_PERIOD_PRUNE_MANIFEST.some((m)=>m.source===f.source&&m.period===f.period));
  if(!file)return {status:"no_unchecked_archives" as const};
  const itemKey=file.source==='ncua'?'acct_452':'service_charges_deposits_ytd';
  const ref:ColdFileRef={source:file.source,period:file.period,objectKey:file.object_key,rowCount:Number(file.row_count),sha256:file.sha256};
  const read=await readColdCallRows([ref],{itemKey,institutionIds:null});
  if(read.failed.length||read.incomplete?.length||!read.rows.length)throw new Error("Historical acceptance requires a complete verified archive read");
  const sample=read.rows[0];
  const [expected]=coldInstitutionSeries([sample]);
  const result=await queryData({measure:`call:${itemKey}`,scope:{kind:"institution",id:String(sample.institution_id)},
    period:{from:file.period.slice(0,7),to:file.period.slice(0,7)},limit:1});
  if(!result.ok||result.rows.length!==1)throw new Error("Hamilton historical query did not return the archived sample");
  const actual=result.rows[0] as Record<string,unknown>;
  for(const key of ["period","item_code","item_description","schedule","value","unit","period_basis","source","source_url"] as const) {
    if(actual[key]!==expected[key])throw new Error(`Hamilton historical query differs from its archived ${key}`);
  }
  const fetched=expected.fetched_at==null?null:new Date(expected.fetched_at).toISOString();
  if(actual.institution_id!==sample.institution_id||actual.fetched_at!==fetched||result.citation.fetched_at!==fetched||result.citation.source_url!==expected.source_url||result.citation.as_of!==expected.period)throw new Error("Hamilton historical citation or identity differs from the archived sample");
  if (file.source === "ffiec") {
    const history = await getInstitutionCallItemHistory(sample.institution_id);
    const publicRow = history.find((row) => row.report_date === file.period && row.item_key === itemKey);
    if (!publicRow || publicRow.value !== sample.value || publicRow.unit !== sample.unit || publicRow.item_code !== sample.item_code || publicRow.item_description !== sample.item_description || publicRow.period_basis !== sample.period_basis) throw new Error("Public institution history differs from its archive");
  } else {
    const series = (await readNcuaCallSeries()).find((row) => row.key === itemKey);
    if (!series || series.periodMin > file.period || series.periodMax < file.period) throw new Error("NCUA discovery no longer advertises the archived quarter");
  }
  return {status:"verified" as const,consumersVerified:true,phase:beforePrune?"before_prune":"after_prune",source:file.source,period:file.period,sha256:file.sha256,
    institutionId:sample.institution_id,itemKey,value:expected.value,unit:expected.unit,sourceUrl:expected.source_url};
}
