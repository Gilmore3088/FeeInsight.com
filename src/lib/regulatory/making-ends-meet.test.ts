import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  answerLabel,
  classifyMemLinks,
  computeMakingEndsMeet,
  csvHeaders,
  fetchMakingEndsMeet,
  MEM_DATA_URL_ENV,
  normCode,
  parseTableCodebook,
  parseTextCodebook,
  parseValueLabels,
  plannedColumns,
  readColumns,
  waveFromFileName,
  wavePeriod,
  type Codebook,
} from "./making-ends-meet";

/** A codebook laid out as the CFPB tables usually are: long format, one value label per row. */
const TABLE_CODEBOOK: string[][] = [
  ["Making Ends Meet public-use file codebook"],
  ["Variable name", "Question text", "Value", "Value label"],
  ["survey_wave", "Survey wave", "1", "June 2019"],
  ["", "", "2", "June 2022"],
  ["pwgt", "Survey weight for the respondent", "", ""],
  ["q_od", "In the past 12 months, how many times did you or anyone in your household pay an overdraft or NSF fee?", "1", "None"],
  ["", "", "2", "1 time"],
  ["", "", "3", "2 or more times"],
  ["", "", "-1", "Refused"],
  ["q_acct", "Do you or anyone in your household have a checking or savings account at a bank or credit union?", "1", "Yes"],
  ["", "", "2", "No"],
  ["q_bills", "In the past 12 months, has your household had difficulty paying for a bill or expense?", "1", "Yes"],
  ["", "", "2", "No"],
  ["q_payday", "In the past 12 months, did you use a payday loan?", "1", "Yes"],
  ["", "", "2", "No"],
  ["q_pawn", "In the past 12 months, did you use a pawn loan?", "1", "Yes"],
  ["", "", "2", "No"],
  ["q_emerg", "If you faced an unexpected expense of $2,000, could you cover it within a month?", "1", "Certainly could"],
  ["", "", "2", "Probably could"],
  ["", "", "3", "Probably could not"],
  ["", "", "4", "Certainly could not"],
  ["q_late", "In the past 12 months, did you pay a late fee on a bill?", "1", "Yes"],
  ["", "", "2", "No"],
  ["cs_band", "Credit score band from the credit record (Bureau risk score)", "1", "Below 600"],
  ["", "", "2", "600-719"],
  ["", "", "3", "720 or above"],
  ["", "", "9", "No score"],
  ["inc", "Annual household income", "1", "Less than $40,000"],
  ["", "", "2", "$40,000 or more"],
  ["region4", "Census region", "1", "Northeast"],
  ["", "", "2", "Midwest"],
  ["", "", "3", "South"],
  ["", "", "4", "West"],
  ["q_mood", "How do you feel today?", "1", "Fine"],
];

const HEADER = "survey_wave,pwgt,q_od,q_acct,q_bills,q_payday,q_pawn,q_emerg,q_late,cs_band,inc,region4,q_mood,extra_col";
const DATA = [
  HEADER,
  // wave 2022
  "2,1,1,1,2,2,2,1,2,3,2,1,1,x",
  "2,1,2,1,1,1,2,3,1,1,1,3,1,x",
  "2,2,3,1,1,2,2,4,1,1,1,3,1,x",
  "2,1,1,1,2,2,2,2,2,2,2,4,1,x",
  "2,1,-1,2,1,2,1,4,,9,1,2,1,x",
  // wave 2019
  "1,1,1,1,2,2,2,1,2,3,2,1,1,x",
  "1,1,2,1,1,2,2,3,1,1,1,3,1,x",
  ",1,1,1,2,2,2,1,2,3,2,1,1,x",
].join("\n");

function tableBook(): Codebook {
  const book = parseTableCodebook(TABLE_CODEBOOK);
  if (!book) throw new Error("codebook not read");
  return book;
}

function compute() {
  const headers = csvHeaders(DATA);
  const book = tableBook();
  const rows = readColumns(DATA, plannedColumns(book, headers));
  return computeMakingEndsMeet({ codebook: book, files: [{ name: "puf.csv", url: "https://x/puf.csv", headers, rows, waveFromName: null }] }, "https://x/puf.csv");
}

const find = (rows: ReturnType<typeof compute>["rows"], key: string, period = "2022") => rows.find((r) => r.series_key === key && r.period === period);

describe("codebook reading", () => {
  it("reads value labels in the common layouts and drops frequency columns", () => {
    expect(parseValueLabels("1 = Yes 2 = No -1 = Refused")).toEqual([
      { code: "1", label: "Yes" },
      { code: "2", label: "No" },
      { code: "-1", label: "Refused" },
    ]);
    expect(parseValueLabels("1. Very difficult 345 12.3%\n2) Not at all difficult 1,200 40.1%\n3 $20,000 to $39,999")).toEqual([
      { code: "1", label: "Very difficult" },
      { code: "2", label: "Not at all difficult" },
      { code: "3", label: "$20,000 to $39,999" },
    ]);
    expect(normCode("01")).toBe("1");
    expect(normCode("2.0")).toBe("2");
  });

  it("reads a long-format table codebook", () => {
    const book = tableBook();
    const od = book.entries.find((e) => e.variable === "q_od")!;
    expect(od.text).toMatch(/overdraft or NSF fee/);
    expect(od.labels).toHaveLength(4);
    expect(book.entries.find((e) => e.variable === "pwgt")!.labels).toEqual([]);
  });

  it("reads a text (PDF) codebook anchored on the data's own column names", () => {
    const text = [
      "Making Ends Meet codebook",
      "Variable: WAVE Survey wave",
      "2019 June 2019",
      "2022 June 2022",
      "WGT Final survey weight",
      "OD12 In the past 12 months, did you pay an overdraft fee?",
      "1 Yes 1,234 20.1%",
      "2 No 4,567 79.9%",
      "-1 Refused 12 0.1%",
    ].join("\n");
    const book = parseTextCodebook(text, ["WAVE", "WGT", "OD12", "NOT_DOCUMENTED"]);
    expect(book.entries.map((e) => e.variable)).toEqual(["WAVE", "WGT", "OD12"]);
    const od = book.entries[2];
    expect(od.text).toBe("In the past 12 months, did you pay an overdraft fee?");
    expect(od.labels).toEqual([
      { code: "1", label: "Yes" },
      { code: "2", label: "No" },
      { code: "-1", label: "Refused" },
    ]);
  });

  it("names a label from the codebook, takes text answers as they are, and refuses unlabelled codes", () => {
    const labels = new Map([["1", "Yes"]]);
    expect(answerLabel(labels, "1.0")).toEqual({ label: "Yes", unlabelled: null });
    expect(answerLabel(labels, "No")).toEqual({ label: "No", unlabelled: null });
    expect(answerLabel(labels, "7")).toEqual({ label: null, unlabelled: "7" });
    expect(answerLabel(labels, "")).toEqual({ label: null, unlabelled: null });
  });

  it("reads waves from labels and only wave-named file names", () => {
    expect(wavePeriod("1", "June 2019")).toEqual({ year: "2019", month: "06" });
    expect(wavePeriod("2022", null)).toEqual({ year: "2022", month: null });
    expect(wavePeriod("1", "First wave")).toBeNull();
    expect(waveFromFileName("https://x/mem_2019_puf.csv")).toBe("2019");
    expect(waveFromFileName("https://x/cfpb_puf_2024-05.csv")).toBeNull();
  });
});

describe("computeMakingEndsMeet", () => {
  it("finds every question by wording and reports the overdraft question", () => {
    const r = compute();
    expect(r.report.weight.variable).toBe("pwgt");
    expect(r.report.waveVariable).toBe("survey_wave");
    expect(r.report.overdraftQuestionInPublicFile).toBe(true);
    const chosen = Object.fromEntries(r.report.questions.map((q) => [q.key, q.chosen]));
    expect(chosen).toMatchObject({
      mem_paid_overdraft_fee: ["q_od"],
      mem_has_bank_account: ["q_acct"],
      mem_difficulty_paying_bills: ["q_bills"],
      mem_used_payday_loan: ["q_payday"],
      mem_used_pawn_loan: ["q_pawn"],
      mem_used_auto_title_loan: [],
      mem_could_cover_emergency_expense: ["q_emerg"],
      mem_paid_late_fee: ["q_late"],
      mem_credit_score_band: ["cs_band"],
    });
    expect(chosen.mem_used_any_afs.sort()).toEqual(["q_pawn", "q_payday"]);
    expect(r.missingFields).toContain("mem_used_auto_title_loan (no question with this wording)");
    expect(r.report.dimensions.income.variable).toBe("inc");
    expect(r.report.dimensions.region.variable).toBe("region4");
    expect(r.report.unexpected.undocumentedExamples).toEqual(["extra_col"]);
    expect(r.skipped).toEqual({ unreadable_wave: 1 });
    expect(r.report.waves.map((w) => w.wave)).toEqual(["2022", "2019"]);
  });

  it("computes weighted shares with counts, excluding refusals, never counting them as no", () => {
    const r = compute();
    // 2022 overdraft answers: None(w1), 1 time(w1), 2+(w2), None(w1), Refused -> excluded.
    const od = find(r.rows, "mem_paid_overdraft_fee")!;
    expect(od.value).toBe(60);
    expect(od.raw).toMatchObject({ respondents: 4, positive_respondents: 2, weighted_base: 5, variables: ["q_od"] });
    expect(od.note).toMatch(/fewer than 50/);
    expect(find(r.rows, "mem_paid_overdraft_fee", "2019")!.value).toBe(50);
    // Count bands are a distribution of their own.
    expect(find(r.rows, "mem_paid_overdraft_fee_times_2_or_more_times")!.value).toBe(40);
    // Bank account: yes weights 1+1+2+1 = 5 of a weighted base of 6.
    expect(find(r.rows, "mem_has_bank_account")!.value).toBeCloseTo(83.33, 2);
    // Could cover: certainly(1) + probably(1) yes of weight 6 total.
    expect(find(r.rows, "mem_could_cover_emergency_expense")!.value).toBeCloseTo(33.33, 2);
  });

  it("breaks out income bands and regions under the nation, keeping counts", () => {
    const r = compute();
    const low = find(r.rows, "mem_paid_overdraft_fee_by_income_less_than_40_000")!;
    expect(low).toMatchObject({ geo_type: "nation", geo_code: "US" });
    expect(low.raw).toMatchObject({ respondents: 2 });
    expect(find(r.rows, "mem_paid_overdraft_fee_by_region_south")!.value).toBe(100);
    expect(r.rows.some((r2) => r2.geo_type === "state")).toBe(false);
  });

  it("compares overdraft payers with non-payers on the stress measures", () => {
    const r = compute();
    const payers = find(r.rows, "mem_difficulty_paying_bills_among_od_payers")!;
    const non = find(r.rows, "mem_difficulty_paying_bills_among_od_nonpayers")!;
    // Payers rows 2 (w1, yes) and 3 (w2, yes): 100%. Non-payers rows 1 and 4: both no.
    expect(payers.value).toBe(100);
    expect(payers.raw).toMatchObject({ respondents: 2, positive_respondents: 2 });
    expect(non.value).toBe(0);
    expect(non.raw).toMatchObject({ respondents: 2, positive_respondents: 0 });
    expect(find(r.rows, "mem_credit_score_band_below_600_among_od_payers")!.value).toBe(100);
  });

  it("refuses a measure with an answer label it cannot place, and says which", () => {
    const book = tableBook();
    const bills = book.entries.find((e) => e.variable === "q_bills")!;
    bills.labels = [
      { code: "1", label: "Yes" },
      { code: "2", label: "Sometimes" },
    ];
    const headers = csvHeaders(DATA);
    const rows = readColumns(DATA, plannedColumns(book, headers));
    const r = computeMakingEndsMeet({ codebook: book, files: [{ name: "f", url: "u", headers, rows, waveFromName: null }] }, "u");
    expect(r.rows.some((x) => x.series_key.startsWith("mem_difficulty_paying_bills"))).toBe(false);
    const use = r.report.waves[0].measures.mem_difficulty_paying_bills![0];
    expect(use).toMatchObject({ usable: false, unclassified: ["Sometimes"] });
  });

  it("says plainly when the overdraft question is not in the file, and loads nothing for it", () => {
    const book = tableBook();
    book.entries = book.entries.filter((e) => e.variable !== "q_od");
    const headers = csvHeaders(DATA);
    const rows = readColumns(DATA, plannedColumns(book, headers));
    const r = computeMakingEndsMeet({ codebook: book, files: [{ name: "f", url: "u", headers, rows, waveFromName: null }] }, "u");
    expect(r.report.overdraftQuestionInPublicFile).toBe(false);
    expect(r.missingFields).toContain("overdraft fee question: not in the public file (nothing loaded for it)");
    expect(r.rows.some((x) => /overdraft|_od_/.test(x.series_key))).toBe(false);
    expect(find(r.rows, "mem_has_bank_account")).toBeDefined();
  });

  it("computes nothing without a single survey weight", () => {
    const book = tableBook();
    book.entries = book.entries.filter((e) => e.variable !== "pwgt");
    const headers = csvHeaders(DATA);
    const r = computeMakingEndsMeet({ codebook: book, files: [{ name: "f", url: "u", headers, rows: readColumns(DATA, headers), waveFromName: null }] }, "u");
    expect(r.rows).toEqual([]);
    expect(r.emptyReason).toMatch(/weight/);
  });
});

describe("transport", () => {
  it("sorts page links into data, codebook and guide, ignoring unrelated files", () => {
    const html = `
      <a href="/f/documents/cfpb_making-ends-meet_public-use-file_csv.zip">CSV</a>
      <a href="/f/documents/cfpb_making-ends-meet_public-use-file_stata.dta">Stata</a>
      <a href="/f/documents/cfpb_making-ends-meet_public-use-file_codebook.pdf">Codebook</a>
      <a href="/f/documents/cfpb_making-ends-meet_public-use-file_user-guide.pdf">Guide</a>
      <a href="/f/documents/cfpb_annual-report.pdf">Other</a>`;
    const links = classifyMemLinks(html, "https://www.consumerfinance.gov/data-research/making-ends-meet-survey-data/");
    expect(links.data).toEqual(["https://www.consumerfinance.gov/f/documents/cfpb_making-ends-meet_public-use-file_csv.zip"]);
    expect(links.unreadableData).toHaveLength(1);
    expect(links.codebooks).toHaveLength(1);
    expect(links.userGuides).toHaveLength(1);
  });

  it("downloads a zip holding the data and a csv codebook, end to end", async () => {
    const codebookCsv = TABLE_CODEBOOK.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const zip = zipSync({ "mem_puf.csv": strToU8(DATA), "mem_codebook.csv": strToU8(codebookCsv) });
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url) === "https://x/data.zip") return new Response(zip);
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await fetchMakingEndsMeet({ [MEM_DATA_URL_ENV]: "https://x/data.zip" }, { fetchImpl, backoffMs: 0 });
    expect(r.emptyReason).toBeNull();
    expect(r.transport.codebookUrl).toBe("zip:mem_codebook.csv");
    expect(r.transport.dataFiles).toEqual([{ name: "mem_puf.csv", rows: 8, columns: 14 }]);
    expect(r.unexpectedFields).toContain("undocumented column: extra_col");
    expect(r.rows.length).toBeGreaterThan(20);
  });

  it("returns empty with every URL tried when nothing can be downloaded", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const r = await fetchMakingEndsMeet({}, { fetchImpl, backoffMs: 0 });
    expect(r.rows).toEqual([]);
    expect(r.emptyReason).toMatch(/MAKING_ENDS_MEET_DATA_URL/);
    expect(Object.values(r.transport.pages)).toEqual(["HTTP 404", "HTTP 404"]);
  });
});
