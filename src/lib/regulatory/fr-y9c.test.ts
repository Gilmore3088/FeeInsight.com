import { describe, expect, it } from "vitest";
import { checkY9cQuality, detectDelimiter, mdrmEntryFor, parseCsvRows, readMdrm, readY9c, Y9C_ITEMS } from "./fr-y9c";

const Q = { year: 2026, quarter: 2 } as const;

describe("readY9c", () => {
  it("loads described caret columns, skips mismatches and keeps blanks absent", () => {
    const text = [
      "RSSD9001^RSSD9999^RSSD9017^RSSD9200^BHCK2170^BHCK4483^BHCK4079",
      "^REPORT DATE^LEGAL NAME^STATE^TOTAL ASSETS^SERVICE CHARGES ON DEPOSIT ACCOUNTS IN DOMESTIC OFFICES^WRONG LABEL",
      "1000^20260630^ALPHA BANCORP^TX^5000000^2500^9000",
      "2000^20260630^BETA FINANCIAL^Texas^^300^100",
    ].join("\n");
    const r = readY9c(text, Q, null);
    expect(r.delimiter).toBe("^");
    expect(r.hasDescriptionRow).toBe(true);
    expect(r.values.map((v) => `${v.rssd}:${v.key}`)).toEqual([
      "1000:total_assets",
      "1000:service_charges_deposit_accounts_ytd",
      "2000:service_charges_deposit_accounts_ytd",
    ]);
    expect(r.columns.find((c) => c.code === "BHCK4079")).toMatchObject({ status: "description_mismatch", description: "WRONG LABEL" });
    expect(r.columns.find((c) => c.code === "BHCK4340")).toMatchObject({ status: "not_in_file" });
    expect(r.filers.find((f) => f.rssd === "2000")).toMatchObject({ state: null, name: "BETA FINANCIAL" });
    expect(r.filers[0].raw.BHCK4079).toBe("9000");
  });

  it("without a description row, checks codes against MDRM and refuses other forms", () => {
    const text = "RSSD9001,BHCK2170,BHCK4340\n1000,5000000,40\n";
    const mdrm = readMdrm(
      'PUBLIC\n"Mnemonic","Item Code","Start Date","End Date","Item Name","Confidentiality","ItemType","Reporting Form","Description"\n' +
        '"BHCK","2170","1/1/1986 12:00:00 AM","12/31/9999 12:00:00 AM","TOTAL ASSETS","N","F","FR Y-9C","Line\nwith newline"\n' +
        '"BHCK","4340","1/1/1986 12:00:00 AM","12/31/9999 12:00:00 AM","NET INCOME","N","F","FR Y-9LP",""\n',
      new Set(["BHCK2170", "BHCK4340"]),
    );
    expect(mdrm.headerFound).toBe(true);
    const r = readY9c(text, Q, mdrm.entries);
    expect(r.hasDescriptionRow).toBe(false);
    expect(r.columns.find((c) => c.code === "BHCK2170")).toMatchObject({ status: "loaded", descriptionSource: "mdrm" });
    expect(r.columns.find((c) => c.code === "BHCK4340")).toMatchObject({ status: "not_on_y9c" });
    expect(readY9c(text, Q, null).columns.find((c) => c.code === "BHCK2170")?.status).toBe("no_description");
  });

  it("counts duplicate and non-numeric ids", () => {
    const r = readY9c('RSSD9001\tBHCK2170\n""\t"TOTAL ASSETS"\n1\t5\n1\t6\nX\t7\n', Q, null);
    expect(r).toMatchObject({ duplicateRssds: 1, badIdRows: 1 });
    expect(r.values).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("detects delimiters and parses quoted CSV", () => {
    expect(detectDelimiter("A^B")).toBe("^");
    expect(detectDelimiter("A\tB")).toBe("\t");
    expect(parseCsvRows('a,"b,c"\n\n"d""e",f\n')).toEqual([
      ["a", "b,c"],
      ['d"e', "f"],
    ]);
  });

  it("picks the MDRM row valid on the report date", () => {
    const entries = [
      { mnemonic: "BHCK", itemCode: "2170", start: "1986-01-01", end: "2001-12-31", itemName: "OLD", reportingForm: "FR Y-9C" },
      { mnemonic: "BHCK", itemCode: "2170", start: "2002-01-01", end: "9999-12-31", itemName: "TOTAL ASSETS", reportingForm: "FR Y-9C" },
    ];
    expect(mdrmEntryFor(entries, "BHCK2170", "2026-06-30")).toMatchObject({ itemName: "TOTAL ASSETS" });
    expect(mdrmEntryFor(entries, "BHCK9999", "2026-06-30")).toBeNull();
  });
});

describe("checkY9cQuality", () => {
  it("reports negatives, impossible ratios and date mismatches without changing values", () => {
    const text = [
      "RSSD9001^RSSD9999^BHCK2170^BHDM6631^BHDM6636^BHCK4483",
      "^DATE^TOTAL ASSETS^NONINTEREST-BEARING DEPOSITS^INTEREST-BEARING DEPOSITS^SERVICE CHARGES ON DEPOSIT ACCOUNTS",
      "1^20260630^100^80^50^-5",
      "2^20260331^100^10^20^3",
    ].join("\n");
    const read = readY9c(text, Q, null);
    const q = checkY9cQuality(read, Q, Y9C_ITEMS);
    expect(q.negativeWhereImpossible).toEqual([{ rssd: "1", key: "service_charges_deposit_accounts_ytd", value: -5 }]);
    expect(q.depositsOverAssets).toBe(1);
    expect(q.reportDateMismatch).toBe(1);
    expect(read.values.find((v) => v.rssd === "1" && v.key === "service_charges_deposit_accounts_ytd")?.value).toBe(-5);
  });
});
