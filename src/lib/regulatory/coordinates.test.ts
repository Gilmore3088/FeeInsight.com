import { describe, expect, it, vi } from "vitest";
import { validCoordinates } from "./coordinates";
import { parseFdicSod } from "./fdic";
import { parseCensusBatch } from "./census-geocoder";
import { placePointInTract } from "./economy";

describe("coordinate input boundaries", () => {
  it.each([[138.097,9.538],[91,-80],[35,-181],[NaN,-80],[35,Infinity],[null,-80],[35,null]])("rejects invalid %s,%s", (lat,lon) => {
    expect(validCoordinates(lat,lon)).toBe(false);
  });
  it("keeps actual valid pairs, including zero, rather than guessing a swap", () => {
    expect(validCoordinates(0,0)).toBe(true);
    expect(validCoordinates(9.538,138.097)).toBe(true);
    expect(validCoordinates(32,-97)).toBe(true);
    const row = parseFdicSod({ CERT:20884,YEAR:2026,BRNUM:36,STALPBR:"FM",SIMS_LATITUDE:138.097,SIMS_LONGITUDE:9.538 });
    expect(row).toMatchObject({latitude:null,longitude:null});
  });
  it("does not send invalid historic coordinates to the point geocoder", async () => {
    const fetchImpl = vi.fn();
    expect(await placePointInTract(138.097,9.538,{fetchImpl})).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects malformed coordinates in an apparently matched Census row", () => {
    const rows = parseCensusBatch('1,"input",Match,Exact,"address","9.538,138.097",1,L');
    expect(rows[0]).toMatchObject({matched:false,latitude:null,longitude:null});
    expect(parseCensusBatch('1,"input",Match,Exact,"address",",",1,L')[0].matched).toBe(false);
  });
});
