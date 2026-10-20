import { describe, expect, it } from "vitest";
import { cityFeeValue, foldStateMarketCities, type CitySpellingRow } from "./city-market";

describe("city market fee value", () => {
  it("keeps the schedule's own line, drops the pipeline note and says when no account is named", () => {
    const value = cityFeeValue({
      fee_category: "overdraft",
      amount: "36.00",
      fee_name: "Truist will charge you an Overdraft Fee, if applicable, of",
      conditions: null,
      account_product_type: null,
      waiver_text: null,
      extraction_note:
        'Knox deterministic extraction from Rosetta artifact #6250. canonical_hint=overdraft; text_hash=abc; excerpt="• Truist will charge you an Overdraft Fee, if applicable, of $36 each time we pay an overdraft on your behalf."',
      source_url: "https://example.com/schedule.pdf",
      read_on: "2026-10-01",
    });
    expect(value.amount).toBe(36);
    expect(value.account).toBeNull();
    expect(value.source_line).toContain("of $36 each time we pay an overdraft");
    expect(value.source_line).not.toMatch(/text_hash|artifact #/);
    expect(value.conditions.join(" ")).not.toMatch(/Knox|text_hash/);
  });

  it("names the account when the catalog stores one", () => {
    const value = cityFeeValue({ fee_category: "monthly_maintenance", amount: 12, fee_name: "Monthly Maintenance", account_product_type: "Premier Checking" });
    expect(value.account).toBe("Premier Checking");
    expect(value.source_line).toBeNull();
  });
});

describe("state directory city fold", () => {
  const row = (city: string, institution_ids: number[], published_ids: number[], branches: number, lat: number | null = 27.77): CitySpellingRow => ({
    city,
    institution_ids,
    published_ids,
    branches,
    metro: null,
    lat,
    lon: lat == null ? null : -82.64,
  });

  it("folds the St. Petersburg spellings into one city and counts each institution once", () => {
    const cities = foldStateMarketCities([
      row("TAMPA", [1, 2, 3, 4], [1, 2], 90),
      row("ST. PETERSBURG", [1, 5, 6], [1, 5], 40, 27.7),
      row("SAINT PETERSBURG", [5, 7], [5], 25, null),
      row("ST PETERSBURG", [6], [], 3),
      row("ST. PETERSBERG", [8], [8], 1),
    ]);
    expect(cities).toHaveLength(2);
    const stPete = cities.find((c) => c.city === "ST. PETERSBURG")!;
    expect(stPete.spellings).toEqual(["ST. PETERSBURG", "SAINT PETERSBURG", "ST PETERSBURG", "ST. PETERSBERG"]);
    // Institutions 1, 5, 6, 7, 8: 5 and 6 have branches under two spellings and count once.
    expect(stPete.institutions).toBe(5);
    expect(stPete.with_fees).toBe(3);
    expect(stPete.branches).toBe(69);
    // The map point comes from the most-used spelling with coordinates.
    expect(stPete.lat).toBe(27.7);
    // Largest first after the fold.
    expect(cities.map((c) => c.city)).toEqual(["ST. PETERSBURG", "TAMPA"]);
  });

  it("folds Port St. Lucie and keeps a city once one of its spellings has fees", () => {
    const cities = foldStateMarketCities([
      row("PORT ST. LUCIE", [10, 11], [], 12),
      row("PORT SAINT LUCIE", [11, 12], [12], 9),
      row("PORT ST LUCIE", [13], [], 2),
      row("NOWHERE", [20], [], 1),
    ]);
    expect(cities.map((c) => [c.city, c.institutions, c.with_fees])).toEqual([["PORT ST. LUCIE", 4, 1]]);
  });
});
