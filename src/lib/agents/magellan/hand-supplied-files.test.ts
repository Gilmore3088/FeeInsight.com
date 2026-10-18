import { describe, expect, it } from "vitest";

import { huntRowForFile, parseCsv, parseHuntCsv, parseSuppliedFileName, planHuntRows } from "./hand-supplied-files";

const HEADER =
  "order,tier,institution_id,institution,state,type,assets_$B,website,link_on_file_(not_a_schedule),last_fetch_code,status,found_url,file_name,effective_date,notes";

describe("hand-supplied file names", () => {
  it("reads the institution id, short name and audience", () => {
    expect(parseSuppliedFileName("102__townebank__consumer.pdf")).toEqual({ institutionId: 102, shortName: "townebank", audience: "consumer" });
    expect(parseSuppliedFileName("96__beacon-bank__business.PDF")).toEqual({ institutionId: 96, shortName: "beacon-bank", audience: "business" });
    // A browser's second download, a folder path and a name with no audience.
    expect(parseSuppliedFileName("downloads/8322__alliant__consumer (1).pdf")?.institutionId).toBe(8322);
    expect(parseSuppliedFileName("133__bell.pdf")).toEqual({ institutionId: 133, shortName: "bell", audience: "consumer" });
  });

  it("refuses a name without the id prefix or not a PDF", () => {
    expect(parseSuppliedFileName("townebank__consumer.pdf")).toBeNull();
    expect(parseSuppliedFileName("102_townebank_consumer.pdf")).toBeNull();
    expect(parseSuppliedFileName("102__townebank__consumer.html")).toBeNull();
    expect(parseSuppliedFileName("0__x__consumer.pdf")).toBeNull();
  });
});

describe("browser hunt CSV", () => {
  it("parses quoted fields with commas, quotes and line breaks", () => {
    expect(parseCsv('a,b\n"1, 2","say ""hi""\nthere"\r\n')).toEqual([
      ["a", "b"],
      ["1, 2", 'say "hi"\nthere'],
    ]);
  });

  it("reads the hunt sheet's rows by header name", () => {
    const parsed = parseHuntCsv(
      `﻿${HEADER}\n1,1,102,TowneBank,VA,bank,22.6,https://www.townebank.com,,,found_pdf,https://www.townebank.com/fees.pdf,102__townebank__consumer.pdf,2026-01-01,"from the footer, page 2"\n2,1,96,Beacon,MA,bank,22.2,https://www.beaconbank.com,,403,,,,,\n`,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({
      line: 2,
      institutionId: 102,
      institution: "TowneBank",
      status: "FOUND_PDF",
      foundUrl: "https://www.townebank.com/fees.pdf",
      fileName: "102__townebank__consumer.pdf",
      effectiveDate: "2026-01-01",
      notes: "from the footer, page 2",
    });
    expect(parsed.rows[1]).toMatchObject({ line: 3, institutionId: 96, status: "", foundUrl: "" });
  });

  it("refuses a sheet without the columns it needs", () => {
    expect(parseHuntCsv("institution_id,status\n1,FOUND_PDF")).toEqual({ ok: false, error: "The CSV has no found_url column" });
    expect(parseHuntCsv("")).toEqual({ ok: false, error: "The CSV is empty" });
  });
});

describe("matching files to rows and planning the import", () => {
  const sheet = parseHuntCsv(
    [
      HEADER,
      "1,1,102,TowneBank,VA,bank,,,,,FOUND_PDF,https://www.townebank.com/fees.pdf,,,",
      "2,1,96,Beacon,MA,bank,,,,,FOUND_PDF,https://www.beaconbank.com/consumer.pdf,96__beacon__consumer.pdf,,",
      "3,1,96,Beacon,MA,bank,,,,,FOUND_PDF,https://www.beaconbank.com/business.pdf,96__beacon__business.pdf,,",
      "4,1,133,Bell,ND,bank,,,,,FOUND_PAGE,https://www.bell.bank/fees,,,",
      "5,1,8322,Alliant,IL,credit_union,,,,,BLOCKED,,,,",
      "6,1,9001,No Link,IL,bank,,,,,FOUND_PDF,,,,",
    ].join("\n"),
  );
  const rows = sheet.ok ? sheet.rows : [];

  it("matches a file by file_name first, else the one found row for its institution", () => {
    expect(huntRowForFile(rows, "96__beacon__consumer.pdf")?.foundUrl).toBe("https://www.beaconbank.com/consumer.pdf");
    expect(huntRowForFile(rows, "102__towne__consumer.pdf")?.foundUrl).toBe("https://www.townebank.com/fees.pdf");
    // Beacon has two found rows: without its own file_name a file cannot be told apart.
    expect(huntRowForFile(rows, "96__beacon-other__consumer.pdf")).toBeNull();
    expect(huntRowForFile(rows, "8322__alliant__consumer.pdf")).toBeNull();
  });

  it("loads rows with a file from the file, adds found consumer links for the rest and skips the others", () => {
    const plan = planHuntRows(rows, ["102__towne__consumer.pdf"]);
    expect(plan.map((item) => item.kind)).toEqual(["file", "link", "skip", "link", "skip", "skip"]);
    expect(plan[2]).toMatchObject({ kind: "skip", reason: "business schedule: the index reads consumer schedules" });
    expect(plan[4]).toMatchObject({ kind: "skip", reason: "status BLOCKED" });
    expect(plan[5]).toMatchObject({ kind: "skip", reason: "status FOUND_PDF with no found_url" });
  });
});
