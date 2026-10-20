import { describe, expect, it, vi } from "vitest";
import { beaError, BeaKeyError, fetchBea, beaUrl, parseBeaData, BEA_LINES } from "./economy";


const withYears = (fetchImpl:typeof fetch):typeof fetch => (async(input:RequestInfo|URL,init?:RequestInit)=> {
  if(new URL(String(input)).searchParams.get("method")==="GetParameterValuesFiltered")
    return Response.json({BEAAPI:{Results:{ParamValue:[{Key:"2021",Desc:"2021"}]}}});
  return fetchImpl(input,init);
}) as typeof fetch;

// Envelope variants documented by BEA's official us-bea/beaapi response_to_dict.py.
// These are contract fixtures, not a claim of a successful live API request.
describe("BEA error and result envelopes", () => {
  it("retains the code and useful detail hidden behind Unknown error", () => {
    expect(beaError({BEAAPI:{Results:{Error:{APIErrorCode:"999",APIErrorDescription:"Unknown error.",
      ErrorDetail:{Description:"Bad parameter"},AdditionalDetails:"GeoFips was rejected"}}}}))
      .toBe("code=999; Unknown error.; Bad parameter; GeoFips was rejected");
  });
  it("reads multiple API errors and one-element Results arrays", () => {
    expect(beaError({BEAAPI:{Results:[{Error:[{error:"first"},{APIErrorCode:"31",error:"second"}]}]}}))
      .toBe("first | code=31; second");
  });
  it("records request context and redacts an echoed key before throwing", async () => {
    const key="test-private-key";
    const fetchImpl=vi.fn(async()=>Response.json({BEAAPI:{Results:{Error:{APIErrorCode:"999",APIErrorDescription:"Unknown error.",
      AdditionalDetails:`UserID=${key}; key ${key}`}}}})) as unknown as typeof fetch;
    const failure=await fetchBea(2021,key,{fetchImpl:withYears(fetchImpl),retries:0}).catch(e=>e as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("Regional/SAINC1 year=2021 line=1 GeoFips=STATE");
    expect((failure as Error).message).toContain("code=999");
    expect((failure as Error).message).not.toContain(key);
  });
  it("identifies documented invalid-key code 1 even when its text is generic", async () => {
    const fetchImpl=vi.fn(async()=>Response.json({BEAAPI:{Error:{APIErrorCode:"1",APIErrorDescription:"Unknown error."}}})) as unknown as typeof fetch;
    await expect(fetchBea(2021,"test-key",{fetchImpl:withYears(fetchImpl),retries:0})).rejects.toBeInstanceOf(BeaKeyError);
  });
  it("does not report a malformed successful envelope as unpublished data", async () => {
    const fetchImpl=vi.fn(async()=>Response.json({BEAAPI:{Results:{}}})) as unknown as typeof fetch;
    await expect(fetchBea(2021,"test-key",{fetchImpl:withYears(fetchImpl),retries:0})).rejects.toThrow("missing Data array");
  });
  it("accepts documented array results with published units and all three geographies", async () => {
    const fetchImpl=vi.fn(async(input:string)=>{
      const params=new URL(input).searchParams;
      const geo=params.get("GeoFips");
      const GeoFips=geo==="STATE"?"01000":geo==="COUNTY"?"01001":"10180";
      return Response.json({BEAAPI:{Results:[{Data:[{GeoFips,GeoName:"Published area",TimePeriod:"2021",DataValue:"1,234",
        CL_UNIT:params.get("LineCode")==="1"?"Thousands of dollars":params.get("LineCode")==="2"?"Persons":"Dollars"}]}]}});
    }) as unknown as typeof fetch;
    const result=await fetchBea(2021,"test-key",{fetchImpl:withYears(fetchImpl),retries:0});
    expect(result.rows).toHaveLength(9);
    expect(new Set(result.rows.map(r=>r.geo_type))).toEqual(new Set(["state","county","metro"]));
    expect(result.rows[0]).toMatchObject({value:1234,unit:"thousands of dollars"});
    expect(result.url).not.toContain("test-key");
  });
});

describe("BEA geography tables and published years",()=>{
  it("requests annual state income from SAINC1 and county/MSA income from CAINC1",()=>{
    expect(new URL(beaUrl("key",1,"STATE",2025)).searchParams.get("TableName")).toBe("SAINC1");
    expect(new URL(beaUrl("key",1,"COUNTY",2024)).searchParams.get("TableName")).toBe("CAINC1");
    expect(new URL(beaUrl("key",1,"MSA",2024)).searchParams.get("TableName")).toBe("CAINC1");
  });
  it("loads a published state year without requesting an unpublished county/MSA year",async()=>{
    const fetchImpl=vi.fn(async(input:string)=>{
      const params=new URL(input).searchParams;
      const table=params.get("TableName");
      if(params.get("method")==="GetParameterValuesFiltered") {
        const Key=table==="SAINC1"?"2024-2025":"2024";
        return Response.json({BEAAPI:{Results:{ParamValue:{Key,Desc:Key}}}});
      }
      expect(table).toBe("SAINC1");
      expect(params.get("GeoFips")).toBe("STATE");
      return Response.json({BEAAPI:{Results:{Data:[{GeoFips:"01000",GeoName:"Alabama",TimePeriod:"2025",DataValue:"1234"}]}}});
    }) as unknown as typeof fetch;
    const result=await fetchBea(2025,"test-key",{fetchImpl,retries:0});
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every(row=>row.geo_type==="state")).toBe(true);
    expect(result.missingFields.join(" ")).toContain("CAINC1 has no published year 2025");
    expect(fetchImpl).toHaveBeenCalledTimes(5); // two catalogs, three published state lines
  });
  it("does not treat malformed year metadata as permission to request guessed years",async()=>{
    const fetchImpl=vi.fn(async()=>Response.json({BEAAPI:{Results:{}}})) as unknown as typeof fetch;
    await expect(fetchBea(2025,"test-key",{fetchImpl,retries:0})).rejects.toThrow("missing published-year metadata");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("keeps BEA NoteRef suppressions null even when their numeric sentinel is zero",()=>{
    const result=parseBeaData({BEAAPI:{Results:{Data:[
      {GeoFips:"01001",TimePeriod:"2024",DataValue:"0",NoteRef:"(D)"},
      {GeoFips:"01003",TimePeriod:"2024",DataValue:"0",NoteRef:"(NA)"},
      {GeoFips:"01005",TimePeriod:"2024",DataValue:"0"},
    ]}}},"county",BEA_LINES[0],2024);
    expect(result.rows.map(row=>[row.value,row.note])).toEqual([[null,"(D)"],[null,"(NA)"],[0,null]]);
  });
});
