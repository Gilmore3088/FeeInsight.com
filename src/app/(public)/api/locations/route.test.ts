import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCityAutocomplete: vi.fn() }));
vi.mock("@/lib/data-store", () => ({ getCityAutocomplete: mocks.getCityAutocomplete }));

import { GET } from "./route";

describe("/api/locations", () => {
  beforeEach(() => {
    mocks.getCityAutocomplete.mockReset();
    mocks.getCityAutocomplete.mockResolvedValue([{ city: "Austin", state_code: "TX", count: 3 }]);
  });

  it("answers a wildcard or punctuation query with an empty list and no read", async () => {
    for (const q of ["%%", "__", "%", "a", "--"]) {
      const response = await GET(new Request(`http://localhost/api/locations?q=${encodeURIComponent(q)}`));
      expect(await response.json()).toEqual([]);
    }
    expect(mocks.getCityAutocomplete).not.toHaveBeenCalled();
  });

  it("cuts the query to 64 characters, asks for 8 rows and lets the edge cache the answer", async () => {
    const response = await GET(new Request(`http://localhost/api/locations?q=${"a".repeat(500)}`));
    expect(mocks.getCityAutocomplete).toHaveBeenCalledWith("a".repeat(64), 8);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
  });
});
