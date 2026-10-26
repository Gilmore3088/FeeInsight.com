import { test } from "vitest";import assert from 'node:assert/strict';
import {readSourceFirstLineage,editionMatches,flagsOf,sourceLineSurvived,exactRawCandidateMatch} from './source-first-recovery-db.ts';
import {diagnoseRecovery} from './source-first-recovery.ts';
const H='a'.repeat(64),NOW='2026-10-26T17:40:00Z';
const fixture=()=>({caseId:'synthetic:wire',institutionId:4,charter:'credit_union',category:'incoming_wire',accountProduct:'consumer checking',audience:'consumer',feeName:'Incoming Wire',amountKind:'flat',amount:15,chargingUnit:'per transfer',conditionKey:'none',semanticKey:'consumer/checking/incoming_wire/15',sourceDocumentId:12,rawFeeIds:[22],normalizedWitnessPhrase:'Incoming Wire $15',source:{url:'https://example.test/schedule',bytesSha256:H,inspectedAt:NOW,inspectedBy:'independent synthetic case',effectiveDate:'2026-01-01',currentConfirmed:true,completeScheduleReviewed:true,officialInstitutionConfirmed:true,excerptRef:'p1 wire table',customerScopeConfirmed:true}});
const db=responses=>{const calls=[];const fn=async function(strings,...values){const sql=strings.join('?');calls.push({sql,values});
if(sql.includes('FROM source_documents'))return responses.doc??[];
if(sql.includes('FROM agent_source_texts'))return responses.text??[];
if(sql.includes('FROM raw_fee_observations'))return responses.raw??[];
if(sql.includes('FROM verified_fee_observations'))return responses.verified??[];
if(sql.includes('FROM published_fee_records'))return responses.published??[];
if(sql.includes('FROM pipeline_attempts'))return responses.attempts??[];
throw new Error(`unrecognized query ${sql}`);
}; fn.calls=calls;return fn;};
function adapter(responses){return db(responses);}
const standard=()=>({doc:[{id:12,institution_id:4,document_url:'https://example.test/schedule',content_hash:H,status:'success',superseded_by_id:null}],text:[{source_document_id:12,status:'completed',exact_witness_present:true,text_hash:H,text_bytes:100}],raw:[{fee_raw_id:22,source_document_id:12,outlier_flags:['needs_darwin_verification']}],verified:[],published:[],attempts:[{stage:'verify',strategy:'darwin',strategy_version:6,created_at:NOW,outcome:'completed'}]});
test('external hash match compares bytes only, missing digests unproven',()=>{assert.equal(editionMatches(H,H),true);assert.equal(editionMatches(H,'b'.repeat(64)),false);assert.equal(editionMatches(null,H),null)});
test('normalized own phrase survives whitespace folding',()=>{assert.equal(sourceLineSurvived('Wire\n Incoming Wire  $15','Incoming Wire $15'),true);assert.equal(sourceLineSurvived('wire fee unknown','Incoming Wire $15'),false);assert.equal(sourceLineSurvived('abc',undefined),null)});
test('flags are only decoded JSON arrays',()=>{assert.deepEqual(flagsOf('["a", "b"]'),['a','b']);assert.deepEqual(flagsOf('{"a":1}'),[])});
test('read-only lineage classifies unverified despite whole-doc verify attempt',async()=>{const d=adapter(standard());const r=await readSourceFirstLineage(d,fixture(),NOW);assert.equal(r.lineage.candidates.length,1);assert.equal(r.lineage.attempts[0].scope,'document');assert.equal(diagnoseRecovery(fixture(),r.lineage).code,'VERIFY_OUTCOME_UNRESOLVED');assert.equal(d.calls.length,5);assert.ok(d.calls.every(x=>x.sql.trim().startsWith('SELECT')));});
test('missing raw pinned ID does not invent a Darwin rejection',async()=>{const x=standard();x.raw=[];const d=adapter(x);const r=await readSourceFirstLineage(d,fixture(),NOW);assert.equal(diagnoseRecovery(fixture(),r.lineage).code,'EXTRACTION_NOT_ESTABLISHED');assert.ok(r.warnings.includes('pinned_raw_ids_not_present_in_current_document'))});
test('no pinned raw IDs exhaust one document but refuses fuzzy/unproved candidates',async()=>{const f=fixture();delete f.rawFeeIds;const d=adapter(standard());const r=await readSourceFirstLineage(d,f,NOW);assert.ok(r.warnings.some(x=>x.includes('no_exact_own_row_candidate')));assert.equal(r.lineage.candidates.length,0);assert.equal(d.calls.length,3);assert.ok(d.calls[2].sql.includes('source_document_id'))});
test('unknown official hash never marks current edition confirmed',async()=>{const f=fixture();f.source.bytesSha256=null;const d=adapter(standard());const r=await readSourceFirstLineage(d,f,NOW);assert.equal(r.lineage.sourceDocument.currentEditionConfirmed,false)});
test('no official inspector publication mapping cannot claim recovered from verified alone',async()=>{const x=standard();x.verified=[{fee_verified_id:31,fee_raw_id:22,review_status:'verified'}];x.published=[{fee_published_id:44,lineage_ref:31,rolled_back_at:null,quarantined_at:null,published_at:NOW,live_in_catalog:true}];const d=adapter(x);const r=await readSourceFirstLineage(d,fixture(),NOW);assert.equal(diagnoseRecovery(fixture(),r.lineage).code,'PUBLICATION_WRONG_OR_WITHDRAWN');assert.equal(r.lineage.publications[0].customerSurfaceConfirmed,false)});
test('external inspector + actual public-page witness allow recovered outcome',async()=>{const x=standard();x.verified=[{fee_verified_id:31,fee_raw_id:22,review_status:'verified'}];x.published=[{fee_published_id:44,lineage_ref:31,rolled_back_at:null,quarantined_at:null,published_at:NOW,live_in_catalog:true}];const f=fixture();f.publishedAdjudications=[{publishedId:44,verdict:'correct',inspectedAt:NOW}];f.customerSightings=[{publishedId:44,seenAt:NOW,url:'https://feeinsight.com/institution/4'}];const r=await readSourceFirstLineage(adapter(x),f,NOW);assert.equal(diagnoseRecovery(f,r.lineage).code,'RECOVERED_CONFIRMED')});
test('no bounded raw trace on excessive pinned IDs',async()=>{const f=fixture();f.rawFeeIds=Array.from({length:30},(_,i)=>i+1);const d=adapter(standard());const r=await readSourceFirstLineage(d,f,NOW);assert.equal(d.calls.length,0);assert.equal(r.lineage.traceComplete,false)});

test('prepublication adjudication cannot certify a newer publication',async()=>{const x=standard();x.verified=[{fee_verified_id:31,fee_raw_id:22,review_status:'verified'}];x.published=[{fee_published_id:44,lineage_ref:31,rolled_back_at:null,quarantined_at:null,published_at:NOW,live_in_catalog:true}];const f=fixture();f.publishedAdjudications=[{publishedId:44,verdict:'correct',inspectedAt:'2026-10-25T17:40:00Z'}];f.customerSightings=[{publishedId:44,seenAt:NOW,url:'https://feeinsight.com/institution/4'}];const r=await readSourceFirstLineage(adapter(x),f,NOW);assert.equal(diagnoseRecovery(f,r.lineage).code,'PUBLICATION_WRONG_OR_WITHDRAWN')});
test('third-party imitation domain is not a Fee Insight customer-surface sighting',async()=>{const x=standard();x.verified=[{fee_verified_id:31,fee_raw_id:22,review_status:'verified'}];x.published=[{fee_published_id:44,lineage_ref:31,rolled_back_at:null,quarantined_at:null,published_at:NOW,live_in_catalog:true}];const f=fixture();f.publishedAdjudications=[{publishedId:44,verdict:'correct',inspectedAt:NOW}];f.customerSightings=[{publishedId:44,seenAt:NOW,url:'https://feeinsight.com.evil.example/institution/4'}];const r=await readSourceFirstLineage(adapter(x),f,NOW);assert.equal(diagnoseRecovery(f,r.lineage).code,'CUSTOMER_SURFACE_UNVERIFIED')});

// A previously missing fee has no published or raw id. The bounded document census
// can find a positively source-owned candidate without assigning an invented id.
test('unpinned obligation traces exact own-source fee through existing Darwin stage',async()=>{
 const f=fixture();delete f.rawFeeIds;
 const x=standard();x.raw=[{fee_raw_id:66,source_document_id:12,fee_name:'Incoming Wire',amount:15,amount_kind:'flat',product_name:null,extraction_note:'excerpt="Incoming Wire $15"',outlier_flags:['needs_darwin_verification']},
 {fee_raw_id:67,source_document_id:12,fee_name:'Outgoing Wire',amount:15,amount_kind:'flat',product_name:null,extraction_note:'excerpt="Outgoing Wire $15"',outlier_flags:[]}];
 x.verified=[];
 const read=await readSourceFirstLineage(adapter(x),f,NOW);
 assert.deepEqual(read.lineage.candidates.map(c=>c.rawId),[66]);
 assert.equal(diagnoseRecovery(f,read.lineage).code,'VERIFY_OUTCOME_UNRESOLVED');
});
test('unpinned same price with wrong product never becomes a positive raw match',()=>{
 const f=fixture();const raw={fee_raw_id:88,fee_name:'Incoming Wire',amount:15,product_name:'business premium',extraction_note:'excerpt="Incoming Wire $15"'};
 assert.equal(exactRawCandidateMatch(raw,f),false);
});
test('document census with more than 300 rows cannot infer an extraction miss',async()=>{
 const f=fixture();delete f.rawFeeIds;
 const x=standard();x.raw=Array.from({length:301},(_,i)=>({fee_raw_id:i+1,source_document_id:12,fee_name:'Incoming Wire',amount:15,extraction_note:'Incoming Wire $15',outlier_flags:[]}));
 const r=await readSourceFirstLineage(adapter(x),f,NOW);
 assert.equal(r.lineage.traceComplete,false);
 assert.ok(r.warnings.includes('source_document_raw_census_exceeds_limit'));
 assert.equal(diagnoseRecovery(f,r.lineage).code,'OFFICIAL_SOURCE_UNPROVEN');
});
test('missing pinned ids and witness refuses to guess',async()=>{
 const f=fixture();delete f.rawFeeIds;delete f.normalizedWitnessPhrase;
 const d=adapter(standard());const r=await readSourceFirstLineage(d,f,NOW);
 assert.equal(r.lineage.traceComplete,false);
 assert.equal(d.calls.length,2);
});