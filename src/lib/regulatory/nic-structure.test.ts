import { describe, expect, it } from "vitest";
import { mergeNicEntities, nicDate, readNicAttributes, readNicRelationships } from "./nic-structure";

describe("readNicRelationships", () => {
  it("keeps dated links, maps the open sentinel to null and counts problems", () => {
    const text = [
      "#ID_RSSD_PARENT,ID_RSSD_OFFSPRING,DT_START,DT_END,RELN_LVL,PCT_EQUITY,NEW_COLUMN",
      "10,20,20200101,99991231,1,100,x",
      "10,20,20200101,99991231,1,100,x",
      "11,20,20100101,20191231,1,,",
      "12,21,,20191231,1,,",
      "abc,21,20100101,20191231,1,,",
      "13,22,20150101,,1,,",
    ].join("\n");
    const r = readNicRelationships(text);
    expect(r.check.missingRequired).toEqual([]);
    expect(r.check.unmapped).toEqual(["NEW_COLUMN"]);
    expect(r.check.missingOptional).toContain("CTRL_IND");
    expect(r.relationships.map((x) => [x.parentRssd, x.endDate, x.pctEquity])).toEqual([
      ["10", null, 100],
      ["11", "2019-12-31", null],
      ["13", null, null],
    ]);
    expect(r.quality).toMatchObject({
      duplicateRelationships: 1,
      undatedRelationships: 1,
      badIdRows: 1,
      openRelationships: 1,
      unparseableEndDates: 1,
    });
  });

  it("loads nothing when a required column is missing", () => {
    const r = readNicRelationships("ID_RSSD_PARENT,ID_RSSD_OFFSPRING,DT_START\n1,2,20200101\n");
    expect(r.check.missingRequired).toEqual(["DT_END"]);
    expect(r.relationships).toEqual([]);
  });
});

describe("readNicAttributes", () => {
  it("keeps only wanted parents and prefers the active row", () => {
    const active = readNicAttributes("#ID_RSSD,NM_LGL,STATE_ABBR_NM\n10,ALPHA CORP,TX\n99,OTHER,ZZZ\n", "active", new Set(["10"]));
    const closed = readNicAttributes("ID_RSSD,NM_LGL,STATE_ABBR_NM\n10,OLD ALPHA,TX\n11,GONE CORP,Texas\n", "closed", new Set(["10", "11"]));
    expect(closed.invalidState).toBe(1);
    const merged = mergeNicEntities(active.entities, closed.entities);
    expect(merged.map((e) => [e.rssd, e.legalName, e.state])).toEqual([
      ["10", "ALPHA CORP", "TX"],
      ["11", "GONE CORP", null],
    ]);
  });

  it("parses NIC date formats", () => {
    expect(nicDate("20240131")).toBe("2024-01-31");
    expect(nicDate("1/5/2024 12:00:00 AM")).toBe("2024-01-05");
    expect(nicDate("2024")).toBeNull();
  });
});
