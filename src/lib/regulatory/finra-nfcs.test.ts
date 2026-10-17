import { strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { ALPHABETICAL_STATES, codebookConfirmsStateOrder, codebookText, fetchNfcs, findVariable, nfcsLinks, summariseNfcs } from "./finra-nfcs";

// Codebook as remembered: variable, question wording, then value labels.
const CODEBOOK = [
  "Variable,Label,Values",
  `STATEQ,In which state do you live?,"${ALPHABETICAL_STATES.map((s, i) => `${i + 1} ${s.name}`).join("; ")}"`,
  "B1,Do you [or your spouse/partner] have a checking account?,1 Yes; 2 No; 98 Don't know; 99 Prefer not to say",
  "B4,Do you [or your spouse/partner] overdraw your checking account occasionally?,1 Yes; 2 No; 98 Don't know; 99 Prefer not to say",
  "J5,\"Have you set aside emergency or rainy day funds that would cover your expenses for 3 months, in case of sickness, job loss, economic downturn, or other emergencies?\",1 Yes; 2 No; 98; 99",
  "J20,How confident are you that you could come up with $2,000 if an unexpected need arose within the next month?,1 I am certain I could come up with the full $2000; 2 I could probably come up with $2000; 3 I could probably not come up with $2000; 4 I am certain I could not come up with $2000",
].join("\n");

const HEADER = ["NFCSID", "STATEQ", "B1", "B4", "J5", "J20", "wgt_n2", "wgt_s3"];
// California is 5, Texas 44 in alphabetical order with DC.
const ca = ALPHABETICAL_STATES.findIndex((s) => s.code === "CA") + 1;
const tx = ALPHABETICAL_STATES.findIndex((s) => s.code === "TX") + 1;
const RESPONDENTS: string[][] = [
  HEADER,
  ["1", String(ca), "1", "1", "1", "1", "1.0", "2.0"],
  ["2", String(ca), "1", "2", "2", "3", "1.0", "1.0"],
  ["3", String(ca), "2", "", "2", "4", "1.0", "1.0"],
  ["4", String(tx), "1", "2", "98", "2", "2.0", "1.0"],
  ["5", String(tx), "99", "", "1", "98", "2.0", "1.0"],
];

describe("NFCS codebook", () => {
  it("finds each question's variable from its wording", () => {
    expect(findVariable(CODEBOOK, /overdraw\b[^?.]{0,60}checking account/i, HEADER).variable).toBe("B4");
    expect(findVariable(CODEBOOK, /come up with \$\s?2,?000/i, HEADER).variable).toBe("J20");
    expect(codebookConfirmsStateOrder(CODEBOOK, "STATEQ")).toBe(true);
    expect(codebookConfirmsStateOrder("STATEQ 1 Alabama 2 Wyoming", "STATEQ")).toBe(false);
  });

  it("reads a CSV codebook to text", async () => {
    expect(await codebookText(strToU8(CODEBOOK))).toMatch(/B1 Do you/);
  });
});

describe("summariseNfcs", () => {
  it("computes weighted state shares with respondent counts and a national share", () => {
    const r = summariseNfcs(RESPONDENTS, CODEBOOK, 2024, "u");
    expect(r.info.state_codes).toBe("alphabetical_numeric");
    const checkingCa = r.rows.find((x) => x.geo_code === "CA" && x.series_key === "nfcs_has_checking_account")!;
    // CA: yes weights 2 + 1 of 4 total.
    expect(checkingCa).toMatchObject({ geo_type: "state", period: "2024", value: 75, unit: "percent of adults (weighted)" });
    expect(checkingCa.raw).toMatchObject({ variable: "B1", respondents: 3, weight_column: "wgt_s3", coding_confirmed: true });
    const checkingUs = r.rows.find((x) => x.geo_type === "nation" && x.series_key === "nfcs_has_checking_account")!;
    // Nation (national weight): yes 1 + 1 + 2 of 5 (TX "99" excluded).
    expect(checkingUs.value).toBe(80);
    const fragileCa = r.rows.find((x) => x.geo_code === "CA" && x.series_key === "nfcs_could_not_cover_2000")!;
    expect(fragileCa.value).toBe(50);
    // J4 (difficulty) is not in this codebook: reported, not computed.
    expect(r.missingFields).toContain("question: Finds it very or somewhat difficult to cover monthly expenses and bills");
    expect(r.info.questions.find((q) => q.key === "nfcs_difficulty_covering_expenses")!.found).toBe(false);
  });

  it("refuses unexpected answer codes and unconfirmed numeric state codes", () => {
    const odd = RESPONDENTS.map((r, i) => (i === 1 ? [...r.slice(0, 2), "7", ...r.slice(3)] : r));
    const r = summariseNfcs(odd, CODEBOOK, 2024, "u");
    expect(r.info.questions.find((q) => q.key === "nfcs_has_checking_account")!.reason).toMatch(/unexpected answer codes 7/);
    const noStates = summariseNfcs(RESPONDENTS, CODEBOOK.replace(/Wyoming/, "Wyo"), 2024, "u");
    expect(noStates.rows).toEqual([]);
    expect(noStates.missingFields.join(" ")).toMatch(/state code labels/);
  });
});

describe("fetchNfcs", () => {
  it("finds the wave's data and codebook on the FINRA page", async () => {
    const page = [
      '<a href="/sites/nfcs/files/NFCS-2024-State-Data-250623.csv">2024 State-by-State Data (CSV)</a>',
      '<a href="/sites/nfcs/files/NFCS-2024-State-Codebook.csv">2024 State Codebook</a>',
      '<a href="/sites/nfcs/files/NFCS-2021-State-Data.csv">2021 State-by-State Data</a>',
    ].join("");
    expect(nfcsLinks(page, "https://www.finrafoundation.org/x", 2024)).toEqual({
      data: ["https://www.finrafoundation.org/sites/nfcs/files/NFCS-2024-State-Data-250623.csv"],
      codebook: ["https://www.finrafoundation.org/sites/nfcs/files/NFCS-2024-State-Codebook.csv"],
    });
    const csv = RESPONDENTS.map((r) => r.join(",")).join("\n");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("State-Data-250623.csv")) return new Response(csv);
      if (url.endsWith("State-Codebook.csv")) return new Response(CODEBOOK);
      return new Response(page);
    }) as unknown as typeof fetch;
    const r = await fetchNfcs(2024, { fetchImpl, retries: 0 });
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("loads nothing without a codebook", async () => {
    const fetchImpl = vi.fn(async () => new Response('<a href="/d/NFCS-2024-State-Data.csv">2024 State Data</a>')) as unknown as typeof fetch;
    const r = await fetchNfcs(2024, { fetchImpl, retries: 0 });
    expect(r.rows).toEqual([]);
    expect(r.emptyReason).toMatch(/codebook/);
  });
});
