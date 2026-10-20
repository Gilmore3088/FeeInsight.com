import { describe,expect,it,vi } from "vitest";
import { emptyTakedownLessons,KNOX_READ_CHECKS,loadTakedownLessons,takedownLessonFlag,takedownLessonsFor } from "./takedown-lessons";
import { exactAmount,prospectiveTakedownIdentity,readTakedownHeader,readTakedownWitness,takedownIdentityKey,type TakedownWitnessHeader } from "./takedown-witness";
import type { ExtractedFeeCandidate } from "./rules";

const candidate=(product:string|null="Alpha Checking",extra:Partial<ExtractedFeeCandidate>={}):ExtractedFeeCandidate=>({
  feeName:"Monthly Service Fee 1",amount:5,frequency:"monthly",canonicalHint:"monthly_maintenance",confidence:.95,
  excerpt:"Monthly Service Fee 1 | $5",waivable:false,
  lineup:product?{productName:product,minBalanceToAvoid:null,minOpeningDeposit:null,waiverText:null}:null,...extra,
});
const hash="a".repeat(64);
const context={institution_id:7,source_document_id:501,document_text_id:701,text_hash:hash};
const header=():TakedownWitnessHeader=>({version:1,check:"hamilton.limit_guard",judgeRunId:9,closureBatchId:"batch-9",
  publishedId:101,verifiedId:201,rawId:301,identity:prospectiveTakedownIdentity(7,candidate())!,
  source:{artifactId:700,sourceDocumentId:500,institutionId:7,hash}});
function lessons() {
  const map=emptyTakedownLessons(),w=header();
  map.set(JSON.stringify([takedownIdentityKey(w.identity),hash]),[{feedbackId:1,feedbackHash:"f",publishedHash:"p",witness:w}]);
  return map;
}

describe("confirmed learned-hold identity (#2186)",()=>{
  it("indexes a complete potential match, without claiming it is a fresh validated hold",()=>{
    expect(takedownLessonsFor(candidate(),lessons(),context)).toHaveLength(1);
    expect(readTakedownHeader(header())).not.toBeNull();
    expect(readTakedownWitness(header())).toBeNull();
  });
  it.each(["Beta Checking",null,"Ü Checking"])("does not borrow Alpha's lesson for %s",product=>{
    expect(takedownLessonsFor(candidate(product),lessons(),context)).toEqual([]);
  });
  it.each([{amount:5.001},{canonicalHint:"paper_statement"},{frequency:"annual"},{feeName:"Monthly Service Fee 2"},
    {excerpt:"Business accounts: Monthly Service Fee 1 | $5"}])("keeps distinct candidate facts %j out",extra=>{
    expect(takedownLessonsFor(candidate("Alpha Checking",extra),lessons(),context)).toEqual([]);
  });
  it("folds supported transport whitespace/ASCII case and preserves unsupported Unicode distinctions",()=>{
    expect(takedownLessonsFor(candidate("\tALPHA\u00a0 Checking\n"),lessons(),context)).toHaveLength(1);
    expect(takedownIdentityKey(prospectiveTakedownIdentity(7,candidate("Ü Checking"))!))
      .not.toBe(takedownIdentityKey(prospectiveTakedownIdentity(7,candidate("ü Checking"))!));
  });
  it("does not apply another bank's, changed-text or unknown-text potential match",()=>{
    for (const changed of [{institution_id:8},{text_hash:"b".repeat(64)},{text_hash:null}])
      expect(takedownLessonsFor(candidate(),lessons(),{...context,...changed})).toEqual([]);
  });
  it("keeps exact decimal values without two-cent rounding or large NUMERIC coercion",()=>{
    expect(exactAmount("001.6500")).toBe("1.65");
    expect(exactAmount("1.651")).not.toBe(exactAmount("1.654"));
    expect(exactAmount("1.00000000000000000001")).not.toBe(exactAmount("1"));
    for (const invalid of [null,Infinity,"NaN","-1","1e9","1.2.3"]) expect(exactAmount(invalid)).toBeNull();
  });
  it("rejects malformed and oversized trusted receipts without clipping them",()=>{
    expect(readTakedownHeader({...header(),source:{...header().source,artifactId:true}})).toBeNull();
    expect(readTakedownHeader({...header(),identity:{...header().identity,conditions:"x".repeat(8001)}})).toBeNull();
    expect(readTakedownWitness({...header(),publishedState:"{}",verifiedState:"{}",rawState:"x".repeat(64001)})).toBeNull();
  });
  it("retains the confirming check in a held row's flag",()=>{
    expect(takedownLessonFlag("hamilton.limit_guard")).toBe("knox_lesson:taken_down:hamilton.limit_guard");
  });
  it("reads confirmed/still-down state and classifies unbound history explicitly",async()=>{
    const queries:string[]=[];
    const db=Object.assign(vi.fn((strings:TemplateStringsArray,...values:unknown[])=>{
      const query=strings.reduce((s,p,i)=>s+(i?String(values[i-1]):"")+p,"");queries.push(query);
      return Promise.resolve(query.includes("to_regclass")?[{ready:true}]:[
        {check_name:"hamilton.limit_guard",witness_header:null},
        {check_name:"hamilton.source_check",witness_header:null},
      ]);
    }),{unsafe:(value:string)=>value});
    const result=await loadTakedownLessons(db as never,[7]);
    expect(result.size).toBe(0);
    expect(result.unknownReasons).toEqual({missing_or_invalid_original_witness:1,unsupported_producer:1});
    const query=queries.find(q=>q.includes("pipeline_feedback f"))!;
    expect(query).toContain("f.kind='takedown_confirmed'");
    expect(query).toContain("fp.rolled_back_at IS NOT NULL");
    expect(query).toContain("live.rolled_back_at IS NULL");
    expect(query).toContain("live_raw.product_name");
    expect(KNOX_READ_CHECKS).not.toContain("hamilton.category_guard");
  });
});
