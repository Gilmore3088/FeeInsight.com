import { describe, expect, it, vi } from "vitest";
import { beaError, BeaKeyError, fetchBea } from "./economy";

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
    const failure=await fetchBea(2021,key,{fetchImpl,retries:0}).catch(e=>e as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("Regional/CAINC1 year=2021 line=1 GeoFips=STATE");
    expect((failure as Error).message).toContain("code=999");
    expect((failure as Error).message).not.toContain(key);
  });
  it("identifies documented invalid-key code 1 even when its text is generic", async () => {
    const fetchImpl=vi.fn(async()=>Response.json({BEAAPI:{Error:{APIErrorCode:"1",APIErrorDescription:"Unknown error."}}})) as unknown as typeof fetch;
    await expect(fetchBea(2021,"test-key",{fetchImpl,retries:0})).rejects.toBeInstanceOf(BeaKeyError);
  });
  it("does not report a malformed successful envelope as unpublished data", async () => {
    const fetchImpl=vi.fn(async()=>Response.json({BEAAPI:{Results:{}}})) as unknown as typeof fetch;
    await expect(fetchBea(2021,"test-key",{fetchImpl,retries:0})).rejects.toThrow("missing Data array");
  });
  it("accepts documented array results with published units and all three geographies", async () => {
    const fetchImpl=vi.fn(async(input:string)=>{
      const params=new URL(input).searchParams;
      const geo=params.get("GeoFips");
      const GeoFips=geo==="STATE"?"01000":geo==="COUNTY"?"01001":"10180";
      return Response.json({BEAAPI:{Results:[{Data:[{GeoFips,GeoName:"Published area",TimePeriod:"2021",DataValue:"1,234",
        CL_UNIT:params.get("LineCode")==="1"?"Thousands of dollars":params.get("LineCode")==="2"?"Persons":"Dollars"}]}]}});
    }) as unknown as typeof fetch;
    const result=await fetchBea(2021,"test-key",{fetchImpl,retries:0});
    expect(result.rows).toHaveLength(9);
    expect(new Set(result.rows.map(r=>r.geo_type))).toEqual(new Set(["state","county","metro"]));
    expect(result.rows[0]).toMatchObject({value:1234,unit:"thousands of dollars"});
    expect(result.url).not.toContain("test-key");
  });
});
