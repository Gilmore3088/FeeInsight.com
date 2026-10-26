import { beforeEach, describe, expect, it, vi } from "vitest";
const checks=vi.hoisted(()=>({query:vi.fn(),cold:vi.fn()}));
vi.mock("@/lib/data-catalog/query-data",()=>({queryData:checks.query}));
vi.mock("@/lib/data-catalog/cold-reads",async(original)=>({...await original<typeof import("@/lib/data-catalog/cold-reads")>(),readColdCallRows:checks.cold}));
import { verifyNextArchivedCallRead } from "./storage-read-acceptance";
const file={source:"ffiec",period:"2023-03-31",object_key:"verified-file",row_count:"133446",sha256:"verified-sha"};
const row={institution_id:1,source:"ffiec",report_date:"2023-03-31",item_key:"service_charges_deposits_ytd",item_code:"RIAD4080",item_description:"Filed charge income",schedule:"RI",value:1.25,unit:"thousands",period_basis:"ytd",source_url:"https://official.example/filing",fetched_at:"2026-10-25T12:34:56.123456Z"};
const served={institution_id:1,source:row.source,period:row.report_date,item_code:row.item_code,item_description:row.item_description,schedule:row.schedule,value:1250,unit:"USD",period_basis:row.period_basis,source_url:row.source_url,fetched_at:"2026-10-25T12:34:56.123Z"};
const db=()=>vi.fn().mockResolvedValue([file]) as unknown as Parameters<typeof verifyNextArchivedCallRead>[0];
beforeEach(()=>{
  vi.clearAllMocks();
  checks.cold.mockResolvedValue({rows:[row],failed:[]});
  checks.query.mockResolvedValue({ok:true,rows:[served],citation:{source_url:row.source_url,as_of:row.report_date,fetched_at:served.fetched_at}});
});
describe("Hamilton archived-call acceptance",()=>{
  it("checks the actual shared query's dollars, institution and citation against a verified archive",async()=>{
    expect(await verifyNextArchivedCallRead(db())).toMatchObject({status:"verified",source:"ffiec",period:file.period,value:1250,unit:"USD",institutionId:1,sha256:file.sha256});
    expect(checks.query).toHaveBeenCalledWith({measure:"call:service_charges_deposits_ytd",scope:{kind:"institution",id:"1"},period:{from:"2023-03",to:"2023-03"},limit:1});
  });
  it("does not accept an unscaled figure or the wrong citation",async()=>{
    checks.query.mockResolvedValueOnce({ok:true,rows:[{...served,value:1.25}],citation:{}});
    await expect(verifyNextArchivedCallRead(db())).rejects.toThrow("archived value");
    checks.query.mockResolvedValueOnce({ok:true,rows:[served],citation:{source_url:"https://wrong.example",as_of:file.period,fetched_at:served.fetched_at}});
    await expect(verifyNextArchivedCallRead(db())).rejects.toThrow("citation or identity");
  });
  it("a failed archive or missing served row cannot produce a success receipt",async()=>{
    checks.cold.mockResolvedValueOnce({rows:[row],failed:["checksum"]});
    await expect(verifyNextArchivedCallRead(db())).rejects.toThrow("complete verified archive");
    expect(checks.query).not.toHaveBeenCalled();
    checks.query.mockResolvedValueOnce({ok:true,rows:[],citation:{}});
    await expect(verifyNextArchivedCallRead(db())).rejects.toThrow("did not return");
  });
  it("ignores files outside the reviewed periods and finishes when none remain",async()=>{
    const outside=vi.fn().mockResolvedValue([{...file,period:"2022-03-31"}]) as unknown as Parameters<typeof verifyNextArchivedCallRead>[0];
    expect(await verifyNextArchivedCallRead(outside)).toEqual({status:"no_unchecked_archives"});
    expect(checks.cold).not.toHaveBeenCalled();
  });
});
