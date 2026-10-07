import { describe, expect, it, vi } from "vitest";
import { geocodeBatch, parseCensusBatch, toCensusCsv } from "./census-geocoder";

const RESPONSE = [
  '"1","1355 Kelly Johnson Blvd, Colorado Springs, CO, 80920","Match","Exact","1355 KELLY JOHNSON BLVD, COLORADO SPRINGS, CO, 80920","-104.79,38.94","123","L"',
  '"2","Nowhere Rd, Town, TX, 75001","No_Match"',
].join("\n");

describe("Census batch geocoder", () => {
  it("writes one quoted row per address", () => {
    expect(toCensusCsv([{ id: "7", street: 'Suite "A"', city: "Austin", state: "TX", zip: null }])).toBe(
      '"7","Suite ""A""","Austin","TX",""',
    );
  });

  it("reads longitude,latitude for matches and nothing for misses", () => {
    expect(parseCensusBatch(RESPONSE)).toEqual([
      { id: "1", matched: true, latitude: 38.94, longitude: -104.79 },
      { id: "2", matched: false, latitude: null, longitude: null },
    ]);
  });

  it("posts the addresses as a file upload", async () => {
    const fetchImpl = vi.fn(async () => new Response(RESPONSE));

    const results = await geocodeBatch(
      [{ id: "1", street: "1355 Kelly Johnson Blvd", city: "Colorado Springs", state: "CO", zip: "80920" }],
      { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 0 },
    );

    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("benchmark")).toBe("Public_AR_Current");
    expect(results[0].matched).toBe(true);
  });
});
