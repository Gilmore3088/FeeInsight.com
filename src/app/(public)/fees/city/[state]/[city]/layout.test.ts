import { beforeEach, describe, expect, it, vi } from "vitest";

const getCityInstitutions = vi.fn();
const fullCityForCut = vi.fn();
const hqCityName = vi.fn<(city: string, state: string) => Promise<string | null>>(async () => null);
vi.mock("@/lib/data-store", () => ({
  getCityInstitutions: (...args: unknown[]) => getCityInstitutions(...args),
  fullCityForCut: (...args: unknown[]) => fullCityForCut(...args),
  hqCityName: (city: string, state: string) => hqCityName(city, state),
  cityHasBranches: async () => false,
}));
const getStateMarketCitiesCached = vi.fn<(state: string) => Promise<{ city: string; spellings: string[] }[]>>(async () => []);
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getStateMarketCitiesCached: (state: string) => getStateMarketCitiesCached(state),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { default: CityLayout } = await import("./layout");
const { cityCanonicalPath, dottedCityName, titleCase } = await import("./city-lookup");
const { cityKey } = await import("@/lib/geo/city-names");
const render = (state: string, city: string) => CityLayout({ children: null, params: Promise.resolve({ state, city }) });

describe("city layout (#1165, #1213, #1267)", () => {
  beforeEach(() => {
    getCityInstitutions.mockReset();
    fullCityForCut.mockReset();
    hqCityName.mockReset();
    hqCityName.mockResolvedValue(null);
  });

  it("renders a city with institutions", async () => {
    getCityInstitutions.mockResolvedValue([{ id: 1 }]);
    await expect(render("co", "colorado%20springs")).resolves.toBeNull();
    expect(fullCityForCut).not.toHaveBeenCalled();
  });

  it("redirects a cut name nobody keeps to the full city its institutions moved to", async () => {
    getCityInstitutions.mockImplementation(async (city: string) => (city === "Colorado Springs" ? [{ id: 1 }] : []));
    fullCityForCut.mockResolvedValue("Colorado Springs");
    await expect(render("co", "colorado%20spring")).rejects.toThrow("REDIRECT /fees/city/co/colorado%20springs");
    expect(fullCityForCut).toHaveBeenCalledWith("Colorado Spring", "co");
  });

  it("answers 404 when no full city exists or it has no institutions either", async () => {
    getCityInstitutions.mockResolvedValue([]);
    fullCityForCut.mockResolvedValue(null);
    await expect(render("tx", "nowhere")).rejects.toThrow("NOT_FOUND");
    fullCityForCut.mockResolvedValue("Colorado Springs");
    await expect(render("co", "colorado%20spring")).rejects.toThrow("NOT_FOUND");
  });

  it("redirects an address that dropped a period to the stored spelling", async () => {
    getCityInstitutions.mockImplementation(async (city: string) => (city === "St. Louis" ? [{ id: 1 }] : []));
    await expect(render("mo", "st-louis")).rejects.toThrow("REDIRECT /fees/city/mo/st.%20louis");
    expect(fullCityForCut).not.toHaveBeenCalled();
  });

  it("redirects a second spelling of a folded city to the spelling the directory links to", async () => {
    getCityInstitutions.mockResolvedValue([{ id: 1 }]);
    getStateMarketCitiesCached.mockResolvedValueOnce([
      { city: "ST. PETERSBURG", spellings: ["ST. PETERSBURG", "SAINT PETERSBURG", "ST. PETERSBERG"] },
    ]);
    await expect(render("fl", "saint%20petersburg")).rejects.toThrow("REDIRECT /fees/city/fl/st.%20petersburg");
    getStateMarketCitiesCached.mockResolvedValueOnce([{ city: "ST. PETERSBURG", spellings: ["ST. PETERSBURG", "SAINT PETERSBURG"] }]);
    await expect(render("fl", "st.%20petersburg")).resolves.toBeNull();
  });

  it("never redirects a hyphenated city to its own address", async () => {
    getCityInstitutions.mockResolvedValue([{ id: 1 }]);
    getStateMarketCitiesCached.mockResolvedValueOnce([{ city: "WILKES-BARRE", spellings: ["WILKES-BARRE", "WILKES BARRE"] }]);
    await expect(render("pa", "wilkes-barre")).resolves.toBeNull();
    // The spaced spelling is a second address for the same city, so it goes to the hyphenated one.
    getStateMarketCitiesCached.mockResolvedValueOnce([{ city: "WILKES-BARRE", spellings: ["WILKES-BARRE", "WILKES BARRE"] }]);
    await expect(render("pa", "wilkes%20barre")).rejects.toThrow("REDIRECT /fees/city/pa/wilkes-barre");
  });

  /**
   * #2092: the headquarters list folds spellings, so every spelling of a city now has
   * institutions. Each must still redirect to the one address, through the real fold.
   */
  it("redirects every spelling of a headquarters-only city to the spelling the city lists use", async () => {
    getCityInstitutions.mockResolvedValue([{ id: 1 }]);
    // The stored headquarters spellings in Missouri, folded by the real cityKey.
    const stored = ["St. Louis", "Saint Louis", "ST LOUIS", "Kansas City"];
    hqCityName.mockImplementation(async (city) => stored.find((s) => cityKey(s) === cityKey(city)) ?? null);
    for (const address of ["st-louis", "saint-louis", "st.-louis", "saint%20louis", "st%20louis"]) {
      await expect(render("mo", address)).rejects.toThrow("REDIRECT /fees/city/mo/st.%20louis");
    }
    await expect(render("mo", "st.%20louis")).resolves.toBeNull();
    await expect(render("mo", "kansas%20city")).resolves.toBeNull();
  });

  it("prefers the directory's spelling over the headquarters spelling", async () => {
    getCityInstitutions.mockResolvedValue([{ id: 1 }]);
    hqCityName.mockResolvedValue("Saint Petersburg");
    getStateMarketCitiesCached.mockResolvedValueOnce([{ city: "ST. PETERSBURG", spellings: ["ST. PETERSBURG"] }]);
    await expect(render("fl", "st-petersburg")).rejects.toThrow("REDIRECT /fees/city/fl/st.%20petersburg");
    expect(hqCityName).not.toHaveBeenCalled();
  });

  it("never redirects on a failed directory read, so a recovering read cannot send it back", async () => {
    getCityInstitutions.mockResolvedValue([{ id: 1 }]);
    hqCityName.mockResolvedValue("Saint Petersburg");
    getStateMarketCitiesCached.mockRejectedValueOnce(new Error("timeout"));
    await expect(render("fl", "st.%20petersburg")).resolves.toBeNull();
    expect(hqCityName).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown state without reading the city directory", async () => {
    getStateMarketCitiesCached.mockClear();
    await expect(render("zz", "tampa")).rejects.toThrow("NOT_FOUND");
    expect(getStateMarketCitiesCached).not.toHaveBeenCalled();
  });

  it("answers 404, not 500, for a malformed escape", async () => {
    getCityInstitutions.mockResolvedValue([]);
    fullCityForCut.mockResolvedValue(null);
    await expect(render("mo", "%E0%A4%A")).rejects.toThrow("NOT_FOUND");
  });
});

describe("city names in addresses", () => {
  it("dots the short words a hyphenated address loses", () => {
    expect(dottedCityName("St Louis")).toBe("St. Louis");
    expect(dottedCityName("Ft Worth")).toBe("Ft. Worth");
    expect(dottedCityName("Ste Genevieve")).toBe("Ste. Genevieve");
    expect(dottedCityName("St. Louis")).toBeNull();
    expect(dottedCityName("Stone Mountain")).toBeNull();
  });

  it("keeps a malformed escape as typed", () => {
    expect(titleCase("%E0%A4%A")).toBe("%e0%a4%a");
    expect(titleCase("st.%20louis")).toBe("St. Louis");
  });
});

describe("the city page's canonical address (#2092)", () => {
  it("names a hyphenated city by its own address, the one the layout keeps", async () => {
    getStateMarketCitiesCached.mockResolvedValueOnce([{ city: "WILKES-BARRE", spellings: ["WILKES-BARRE"] }]);
    expect(await cityCanonicalPath("pa", "wilkes-barre")).toBe("/fees/city/pa/wilkes-barre");
    hqCityName.mockResolvedValueOnce("Winston-Salem");
    getStateMarketCitiesCached.mockResolvedValueOnce([]);
    expect(await cityCanonicalPath("nc", "winston-salem")).toBe("/fees/city/nc/winston-salem");
  });

  it("names a second spelling by the city's one address", async () => {
    getStateMarketCitiesCached.mockResolvedValueOnce([{ city: "ST. PETERSBURG", spellings: ["ST. PETERSBURG"] }]);
    expect(await cityCanonicalPath("fl", "saint-petersburg")).toBe("/fees/city/fl/st.%20petersburg");
  });

  it("keeps the requested address when the directory read fails", async () => {
    getStateMarketCitiesCached.mockRejectedValueOnce(new Error("timeout"));
    expect(await cityCanonicalPath("pa", "wilkes-barre")).toBe("/fees/city/pa/wilkes-barre");
  });
});
