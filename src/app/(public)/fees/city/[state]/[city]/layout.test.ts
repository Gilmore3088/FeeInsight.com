import { beforeEach, describe, expect, it, vi } from "vitest";

const getCityInstitutions = vi.fn();
const fullCityForCut = vi.fn();
vi.mock("@/lib/data-store", () => ({
  getCityInstitutions: (...args: unknown[]) => getCityInstitutions(...args),
  fullCityForCut: (...args: unknown[]) => fullCityForCut(...args),
  cityHasBranches: async () => false,
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
const { dottedCityName, titleCase } = await import("./city-lookup");
const render = (state: string, city: string) => CityLayout({ children: null, params: Promise.resolve({ state, city }) });

describe("city layout (#1165, #1213, #1267)", () => {
  beforeEach(() => {
    getCityInstitutions.mockReset();
    fullCityForCut.mockReset();
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
