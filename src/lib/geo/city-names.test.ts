import { describe, expect, it } from "vitest";
import {
  cityKey,
  cityMatches,
  citySearchPrefixes,
  correctSpelling,
  foldCitySpellings,
  isMisspelled,
  placesInFold,
  sameCitySpellings,
} from "./city-names";

describe("cityKey", () => {
  it("folds Saint, St, St. and the Petersberg misspelling into one city", () => {
    const keys = ["Saint Petersburg", "St Petersburg", "St. Petersburg", "ST. PETERSBURG", "St. Petersberg", " st.  petersburg "].map(cityKey);
    expect(new Set(keys)).toEqual(new Set(["ST PETERSBURG"]));
  });

  it("folds every Port St. Lucie spelling", () => {
    const keys = ["Port St. Lucie", "Port St Lucie", "PORT SAINT LUCIE", "port st.lucie".replace(".", ". "), "Port-St.-Lucie"].map(cityKey);
    expect(new Set(keys)).toEqual(new Set(["PORT ST LUCIE"]));
  });

  it("folds Fort/Ft, Mount/Mt, Sainte/Ste, punctuation and case, and keeps different places apart", () => {
    expect(cityKey("Fort Lauderdale")).toBe(cityKey("Ft. Lauderdale"));
    expect(cityKey("Mount Dora")).toBe(cityKey("Mt Dora"));
    expect(cityKey("Sault Sainte Marie")).toBe(cityKey("Sault Ste. Marie"));
    expect(cityKey("Winston-Salem")).toBe(cityKey("WINSTON SALEM"));
    expect(cityKey("O'Fallon")).toBe(cityKey("OFallon"));
    expect(cityKey("St. Petersburg")).not.toBe(cityKey("Petersburg"));
    expect(cityKey("Port St. Lucie")).not.toBe(cityKey("St. Lucie"));
    expect(cityKey("Stuart")).toBe("STUART");
  });
});

describe("correctSpelling and isMisspelled", () => {
  it("corrects a known misspelling in the case it was written", () => {
    expect(correctSpelling("St. Petersberg")).toBe("St. Petersburg");
    expect(correctSpelling("ST. PETERSBERG")).toBe("ST. PETERSBURG");
    expect(correctSpelling("Tampa")).toBe("Tampa");
    expect(isMisspelled("St. Petersberg")).toBe(true);
    expect(isMisspelled("St. Petersburg")).toBe(false);
  });
});

describe("foldCitySpellings", () => {
  it("names the city by its most used correct spelling, never the misspelling", () => {
    const [city, ...rest] = foldCitySpellings([
      { name: "ST. PETERSBERG", branches: 90, row: 1 },
      { name: "ST. PETERSBURG", branches: 40, row: 2 },
      { name: "SAINT PETERSBURG", branches: 60, row: 3 },
      { name: "ST PETERSBURG", branches: 5, row: 4 },
    ]);
    expect(rest).toEqual([]);
    expect(city.key).toBe("ST PETERSBURG");
    expect(city.name).toBe("SAINT PETERSBURG");
    expect(city.spellings.map((s) => s.row)).toEqual([3, 2, 4, 1]);
  });

  it("keeps a misspelling as the name only when it is the only spelling, and leaves other cities alone", () => {
    const folded = foldCitySpellings([
      { name: "ST. PETERSBERG", branches: 3, row: "a" },
      { name: "TAMPA", branches: 200, row: "b" },
      { name: "PORT ST. LUCIE", branches: 20, row: "c" },
      { name: "PORT SAINT LUCIE", branches: 20, row: "d" },
    ]);
    expect(folded.map((c) => [c.key, c.name])).toEqual([
      ["ST PETERSBURG", "ST. PETERSBERG"],
      ["TAMPA", "TAMPA"],
      // A tie goes to the spelling that sorts first.
      ["PORT ST LUCIE", "PORT SAINT LUCIE"],
    ]);
  });
});

describe("cityMatches", () => {
  it("finds St. Petersburg however the reader types it", () => {
    for (const q of ["St Pete", "st pete", "Saint Pete", "st. petersburg", "St. Petersberg", "pete", "sain", "ST"]) {
      expect(cityMatches(q, "St. Petersburg"), q).toBe(true);
    }
  });

  it("finds Port St. Lucie from any spelling, word by word", () => {
    for (const q of ["port st lucie", "Port Saint Lucie", "port st. l", "lucie", "st luc"]) {
      expect(cityMatches(q, "Port St. Lucie"), q).toBe(true);
    }
  });

  it("matches words from their start and in order, and an empty search matches all", () => {
    expect(cityMatches("lauderdale", "Fort Lauderdale")).toBe(true);
    expect(cityMatches("ft laud", "Fort Lauderdale")).toBe(true);
    expect(cityMatches("burg", "St. Petersburg")).toBe(false);
    expect(cityMatches("st", "West Palm Beach")).toBe(false);
    expect(cityMatches("saint", "Stuart")).toBe(false);
    expect(cityMatches("lucie port", "Port St. Lucie")).toBe(false);
    expect(cityMatches("  ", "Tampa")).toBe(true);
  });
});

describe("sameCitySpellings (#2092)", () => {
  it("returns every stored spelling of the asked city, upper case, the asked one first", () => {
    const stored = ["SAINT PETERSBURG", "ST. PETERSBURG", "ST PETERSBERG", "TAMPA", "PETERSBURG"];
    expect(sameCitySpellings("St. Petersburg", stored)).toEqual(["ST. PETERSBURG", "SAINT PETERSBURG", "ST PETERSBERG"]);
  });

  it("keeps a city the fold does not know matching itself", () => {
    expect(sameCitySpellings("Tampa", ["TAMPA", "ORLANDO"])).toEqual(["TAMPA"]);
    expect(sameCitySpellings("Nowhere", [])).toEqual(["NOWHERE"]);
  });
});

describe("placesInFold (#2092)", () => {
  it("finds headquarters records that spell a branch city another way, in the same state only", () => {
    const branches = [{ state: "FL", city: "ST. PETERSBURG" }];
    const hq = [
      { state: "FL", city: "SAINT PETERSBURG" },
      { state: "FL", city: "ST. PETERSBURG" },
      { state: "FL", city: "TAMPA" },
      { state: "VA", city: "SAINT PETERSBURG" },
    ];
    expect(placesInFold(branches, hq)).toEqual(["FL|SAINT PETERSBURG", "FL|ST. PETERSBURG"]);
  });
});

describe("citySearchPrefixes (#2092)", () => {
  it("searches a folded first word in each of its forms", () => {
    expect(citySearchPrefixes("st pete")).toEqual(["st pete", "SAINT pete", "ST pete", "ST. pete"]);
    expect(citySearchPrefixes("Fort Worth")).toEqual(["Fort Worth", "FORT Worth", "FT Worth", "FT. Worth"]);
    expect(citySearchPrefixes("St. Lou")).toEqual(["St. Lou", "SAINT Lou", "ST Lou", "ST. Lou"]);
  });

  it("adds the other forms of a lone first word only as whole words", () => {
    expect(citySearchPrefixes("st")).toEqual(["st", "SAINT ", "ST ", "ST. "]);
  });

  it("leaves any other search as typed", () => {
    expect(citySearchPrefixes("Tampa")).toEqual(["Tampa"]);
    expect(citySearchPrefixes("stuart")).toEqual(["stuart"]);
    expect(citySearchPrefixes("%%")).toEqual(["%%"]);
  });
});
