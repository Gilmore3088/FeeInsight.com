import { describe, expect, it } from "vitest";
import { MAX_ALERT_CATEGORIES, mergeAlertCategories, normalizeAlertCategories } from "./alerts";

describe("normalizeAlertCategories", () => {
  it("treats absent, null and empty as all fees", () => {
    expect(normalizeAlertCategories(undefined)).toEqual({ ok: true, categories: null });
    expect(normalizeAlertCategories(null)).toEqual({ ok: true, categories: null });
    expect(normalizeAlertCategories([])).toEqual({ ok: true, categories: null });
  });

  it("trims and de-duplicates taxonomy categories", () => {
    expect(normalizeAlertCategories([" overdraft", "overdraft", "nsf"])).toEqual({
      ok: true,
      categories: ["overdraft", "nsf"],
    });
  });

  it("rejects non-strings and categories outside the taxonomy", () => {
    expect(normalizeAlertCategories("overdraft")).toMatchObject({ ok: false });
    expect(normalizeAlertCategories([1, 2])).toMatchObject({ ok: false });
    expect(normalizeAlertCategories(["overdraft", "made_up"])).toMatchObject({ ok: false, error: expect.stringContaining("made_up") });
  });

  it("caps how many fees one institution can follow", async () => {
    const { FEE_FAMILIES } = await import("@/lib/fee-taxonomy");
    const many = Object.values(FEE_FAMILIES).flat().slice(0, MAX_ALERT_CATEGORIES + 1);
    expect(normalizeAlertCategories(many)).toMatchObject({ ok: false });
  });
});

describe("mergeAlertCategories", () => {
  it("uses the request as-is for a new subscription", () => {
    expect(mergeAlertCategories(undefined, ["nsf"], false)).toEqual(["nsf"]);
  });

  it("adds to what is already followed", () => {
    expect(mergeAlertCategories(["overdraft"], ["nsf", "overdraft"], true)).toEqual(["overdraft", "nsf"]);
  });

  it("lets all fees win on either side", () => {
    expect(mergeAlertCategories(null, ["nsf"], true)).toBeNull();
    expect(mergeAlertCategories(["overdraft"], null, true)).toBeNull();
  });
});
