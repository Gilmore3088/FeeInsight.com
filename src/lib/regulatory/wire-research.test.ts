import { describe, expect, it } from "vitest";
import { feeTypeSql, feeTypesOf, parseFeeType } from "./wire-fee-types";
import {
  MAX_SOURCE_CHARS,
  billTimeline,
  countSentences,
  dateAppearsInText,
  extractDockets,
  extractInstitutions,
  extractReadableText,
  extractRuleNames,
  isUnreadableBody,
  pressNamesBill,
  relatedBillsForPress,
  relatedFederal,
  relatedPressForBill,
  validateResearch,
  type LinkCandidate,
} from "./wire-research";

const REG_O = "Federal Reserve Board announces it will extend, until November 4, the comment period on its proposal to modernize Regulation O";

describe("extractReadableText", () => {
  it("keeps the page's own words and drops scripts, menus, headers and footers", () => {
    const html = `<!doctype html><html><head><title>x</title><style>.a{color:red}</style><script>var x = 1;</script></head>
      <body><header><nav><a href="/">Home</a><a href="/news">News</a></nav></header>
      <main><h1>Board extends comment period</h1><p>The Federal Reserve Board on Thursday extended the comment period&nbsp;on its proposal.</p>
      <p>Comments are now due November&#160;4, 2026 &amp; may be sent online.</p><!-- hidden note --></main>
      <footer>Contact us · Privacy</footer></body></html>`;
    const { text, truncated } = extractReadableText(html, "text/html; charset=utf-8");
    expect(text).toBe(
      "Board extends comment period\nThe Federal Reserve Board on Thursday extended the comment period on its proposal.\nComments are now due November 4, 2026 & may be sent online.",
    );
    expect(text).not.toMatch(/Home|Privacy|var x|color:red|hidden note/);
    expect(truncated).toBe(false);
  });

  it("falls back to the body without a <main>, and passes plain text through", () => {
    const html = "<html><body><div id=menu><ul><li>A</li></ul></div><article><p>Order &#x2014; terminated.</p></article></body></html>";
    expect(extractReadableText(html, null).text).toBe("Order — terminated.");
    expect(extractReadableText("  Line one  \r\n\r\n\r\n\r\nLine two ", "text/plain").text).toBe("Line one\nLine two");
  });

  it("cuts very long text and says so", () => {
    const long = `<p>${"word ".repeat(10_000)}</p>`;
    const out = extractReadableText(long, "text/html");
    expect(out.text.length).toBe(MAX_SOURCE_CHARS);
    expect(out.truncated).toBe(true);
    expect(out.fullChars).toBeGreaterThan(MAX_SOURCE_CHARS);
  });

  it("treats PDFs and binaries as unreadable", () => {
    expect(isUnreadableBody("%PDF-1.7 ...", null)).toBe(true);
    expect(isUnreadableBody("", "application/pdf")).toBe(true);
    expect(isUnreadableBody("<html></html>", "text/html")).toBe(false);
  });
});

describe("dateAppearsInText", () => {
  const text = "Comments must be received by November 4, 2026. The rule is effective Jan. 1, 2027, or 03/15/2027 for small banks.";

  it("finds a date written out, abbreviated, numeric or ISO", () => {
    expect(dateAppearsInText("2026-11-04", text)).toBe(true);
    expect(dateAppearsInText("2027-01-01", text)).toBe(true);
    expect(dateAppearsInText("2027-03-15", text)).toBe(true);
    expect(dateAppearsInText("2026-11-04", "Deadline: 4 November 2026")).toBe(true);
    expect(dateAppearsInText("2026-11-04", "Filed 2026-11-04.")).toBe(true);
  });

  it("rejects a date the text does not state", () => {
    expect(dateAppearsInText("2026-11-05", text)).toBe(false);
    expect(dateAppearsInText("2026-12-04", text)).toBe(false);
    expect(dateAppearsInText("2026-02-30", text)).toBe(false);
    expect(dateAppearsInText("not a date", text)).toBe(false);
  });

  it("accepts a day with no year only in the item's year or the next, and never against another stated year", () => {
    expect(dateAppearsInText("2026-11-04", REG_O, 2026)).toBe(true);
    expect(dateAppearsInText("2026-11-04", REG_O, null)).toBe(false);
    expect(dateAppearsInText("2028-11-04", REG_O, 2026)).toBe(false);
    expect(dateAppearsInText("2026-11-04", "until November 4, 2025, the period", 2026)).toBe(false);
  });
});

describe("validateResearch", () => {
  const source = `${REG_O}. The Board will accept comments through November 4. The proposal would update insider lending limits.`;
  const good = {
    summary: "The Federal Reserve Board extended the comment period on its Regulation O proposal. Comments are now due November 4.",
    action_type: "comment_period_change",
    comment_deadline: "2026-11-04",
    effective_date: null,
    why_it_matters: "Banks that lend to insiders may want to comment before the deadline.",
  };

  it("accepts a grounded note", () => {
    const out = validateResearch(good, source, 2026);
    expect(out).toEqual({
      ok: true,
      droppedDates: [],
      draft: {
        summary: good.summary,
        actionType: "comment_period_change",
        commentDeadline: "2026-11-04",
        effectiveDate: null,
        whyItMatters: good.why_it_matters,
      },
    });
  });

  it("drops a date the source text does not state and keeps the rest", () => {
    const out = validateResearch({ ...good, effective_date: "2027-01-01", comment_deadline: "2026-11-05" }, source, 2026);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.commentDeadline).toBeNull();
    expect(out.draft.effectiveDate).toBeNull();
    expect(out.droppedDates).toEqual(["comment_deadline:2026-11-05", "effective_date:2027-01-01"]);
  });

  it("rejects what is not strict JSON of the agreed shape", () => {
    expect(validateResearch(null, source, 2026)).toMatchObject({ ok: false, reason: "not_a_json_object" });
    expect(validateResearch([good], source, 2026)).toMatchObject({ ok: false, reason: "not_a_json_object" });
    expect(validateResearch({ ...good, summary: "" }, source, 2026)).toMatchObject({ ok: false, reason: "missing_summary" });
    expect(validateResearch({ ...good, action_type: "press_release" }, source, 2026)).toMatchObject({ ok: false, reason: "unknown_action_type" });
    expect(validateResearch({ ...good, summary: "**Bold** claim. Two." }, source, 2026)).toMatchObject({ ok: false, reason: "summary_not_plain_text" });
    expect(validateResearch({ ...good, summary: "One. Two. Three. Four." }, source, 2026)).toMatchObject({ ok: false, reason: "summary_sentence_count" });
    expect(validateResearch({ unreadable: true }, source, 2026)).toEqual({ ok: false, unreadable: true, reason: "model_said_unreadable" });
  });

  it("drops an interpretation that is not one short plain sentence", () => {
    const out = validateResearch({ ...good, why_it_matters: "x".repeat(400) }, source, 2026);
    expect(out.ok && out.draft.whyItMatters).toBeNull();
  });

  it("does not count abbreviations as sentence ends", () => {
    expect(countSentences("The U.S. Bancorp unit of No. 5 Inc. was fined. It paid Jan. 4.")).toBe(2);
  });
});

describe("link keys", () => {
  it("finds dockets, rule names and institutions", () => {
    expect(extractDockets("Docket No. R-1813 and RIN 7100-AG85; see CFPB-2026-0012 and Docket No. OP-1850.")).toEqual([
      "CFPB-2026-0012",
      "R-1813",
      "OP-1850",
      "7100-AG85",
    ]);
    expect(extractRuleNames("Agencies Announce Final Community Reinvestment Act Rule under Regulation BB and Section 1033")).toEqual([
      "regulation bb",
      "community reinvestment act",
      "section 1033",
    ]);
    expect(extractInstitutions("Federal Reserve Board announces approval of application by First Example Bancorp")).toEqual(["first example bancorp"]);
    expect(extractInstitutions("OCC Announces Enforcement Action Against First National Bank of Elm")).toEqual(["first national bank"]);
    expect(extractInstitutions("Agencies issue statement on community bank leverage; Federal Reserve Bank of Boston names president")).toEqual([]);
  });
});

describe("relatedFederal", () => {
  const target: LinkCandidate = { key: "a", kind: "release", source: "FED", title: REG_O, url: "https://x/a", date: "2026-10-02", dockets: ["R-1850"] };
  const candidates: LinkCandidate[] = [
    target,
    { key: "b", kind: "release", source: "FED", title: "Federal Reserve Board invites comment on proposal to modernize Regulation O", url: "https://x/b", date: "2026-08-20" },
    { key: "c", kind: "rule", source: "FRB", title: "Loans to Executive Officers, Directors, and Principal Shareholders", url: "https://fr/c", date: "2026-08-25", dockets: ["R-1850"] },
    { key: "d", kind: "release", source: "FED", title: "Federal Reserve Board issues Regulation O guidance", url: "https://x/d", date: "2026-01-02" },
    { key: "e", kind: "release", source: "OCC", title: "OCC reports quarterly bank trading revenue", url: "https://x/e", date: "2026-10-01" },
  ];

  it("links by docket first, then rule name, within 90 days, never to itself", () => {
    const related = relatedFederal(target, candidates);
    expect(related.map((r) => [r.key, r.reason])).toEqual([
      ["c", "same docket R-1850"],
      ["b", "also names Regulation O"],
    ]);
  });

  it("links releases about the same institution", () => {
    const approval: LinkCandidate = { key: "m1", kind: "release", source: "FED", title: "Federal Reserve Board announces approval of application by Harbor Example Bancorp", url: "u", date: "2026-09-01" };
    const later: LinkCandidate = { key: "m2", kind: "release", source: "FED", title: "Federal Reserve Board announces termination of enforcement action against Harbor Example Bancorp", url: "u", date: "2026-10-01" };
    expect(relatedFederal(approval, [approval, later]).map((r) => r.reason)).toEqual(["also names Harbor Example Bancorp"]);
  });

  it("links two agencies' copies of the same joint release, and not merely similar headlines", () => {
    const fed: LinkCandidate = { key: "j1", kind: "release", source: "FED", title: "Agencies publish resolution plan feedback letters for 15 banking organizations", url: "u", date: "2026-09-29" };
    const fdic: LinkCandidate = { key: "j2", kind: "release", source: "FDIC", title: "Press Release: Agencies Publish Resolution Plan Feedback Letters for 15 Banking Organizations", url: "u", date: "2026-09-29" };
    const occ: LinkCandidate = { key: "j3", kind: "release", source: "OCC", title: "Comptroller Issues Statement Explaining Vote Against Resolution Plan Feedback for American Express", url: "u", date: "2026-09-29" };
    expect(relatedFederal(fed, [fed, fdic, occ]).map((r) => [r.key, r.reason])).toEqual([["j2", "nearly the same headline (a joint or repeated release)"]]);
    expect(extractInstitutions("OCC Reports Second Quarter 2026 Bank Trading Revenue")).toEqual([]);
  });

  it("finds nothing for a headline with no docket, rule or institution", () => {
    expect(relatedFederal(candidates[4], candidates)).toEqual([]);
  });
});

describe("bills and press", () => {
  const bill = { key: "open_states:ocd-bill/1", state: "CA", identifier: "AB 1520", title: "Overdraft fees: depository institutions: notice", url: "https://os/1", date: "2026-09-10" };
  const other = { key: "open_states:ocd-bill/2", state: "CA", identifier: "SB 79", title: "Housing development: transit", url: null, date: "2026-08-01" };
  const press = [
    { key: "p1", state: "CA", title: "California's AB 1520 would cap bank overdraft fees - CalMatters", url: "https://n/1", date: "2026-09-12" },
    { key: "p2", state: "CA", title: "Lawmakers weigh overdraft fees notice for depository customers - LA Times", url: "https://n/2", date: "2026-09-15" },
    { key: "p3", state: "CA", title: "California banks report strong quarter - Reuters", url: "https://n/3", date: "2026-09-20" },
    { key: "p4", state: "NV", title: "Nevada AB 1520 overdraft fees bill advances - Nevada Current", url: "https://n/4", date: "2026-09-20" },
  ];

  it("links a story that names the bill number or two distinctive title words, in the same state only", () => {
    expect(pressNamesBill(press[0], bill)).toEqual({ linked: true, reason: "names AB 1520" });
    expect(pressNamesBill(press[1], bill).linked).toBe(true);
    expect(pressNamesBill(press[2], bill).linked).toBe(false);
    expect(pressNamesBill(press[3], bill).linked).toBe(false);
  });

  it("lists a bill's coverage newest first and a story's bill", () => {
    expect(relatedPressForBill(bill, press).map((r) => [r.key, r.source])).toEqual([
      ["p2", "LA Times"],
      ["p1", "CalMatters"],
    ]);
    expect(relatedBillsForPress(press[0], [bill, other]).map((r) => [r.key, r.title])).toEqual([
      ["open_states:ocd-bill/1", "AB 1520: Overdraft fees: depository institutions: notice"],
    ]);
  });
});

describe("billTimeline", () => {
  it("shows the introduction and the latest action, and nothing it has no date for", () => {
    expect(billTimeline({ introducedOn: "2026-02-01", stage: "passed_chamber", stageOn: "2026-05-20" })).toEqual([
      { label: "Introduced", date: "2026-02-01", current: false },
      { label: "Passed one chamber", date: "2026-05-20", current: true },
    ]);
    expect(billTimeline({ introducedOn: "2026-02-01", stage: "introduced", stageOn: "2026-02-01" })).toEqual([
      { label: "Introduced", date: "2026-02-01", current: true },
    ]);
    expect(billTimeline({ introducedOn: null, stage: null, stageOn: null })).toEqual([]);
  });
});

describe("fee-type tags", () => {
  it("tags headlines by keyword", () => {
    expect(feeTypesOf("CFPB finalizes rule on overdraft and NSF fees")).toEqual(["overdraft"]);
    expect(feeTypesOf("State caps ATM surcharges for out-of-network withdrawals")).toEqual(["atm"]);
    expect(feeTypesOf("Bank drops monthly maintenance fees on checking")).toEqual(["maintenance"]);
    expect(feeTypesOf("Agencies issue guidance on wire transfer fraud")).toEqual(["wire"]);
    expect(feeTypesOf("Fed proposes lower debit card interchange cap")).toEqual(["card"]);
    expect(feeTypesOf("Bill would ban junk fees at banks")).toEqual(["other"]);
    expect(feeTypesOf("Overdraft and ATM fee relief act")).toEqual(["overdraft", "atm"]);
  });

  it("does not tag on a word inside another word or a release with no fee", () => {
    expect(feeTypesOf("Treatment of trading assets")).toEqual([]);
    expect(feeTypesOf("Federal Reserve Board announces approval of application")).toEqual([]);
    expect(feeTypesOf("Coffee prices rise")).toEqual([]);
  });

  it("gives the same answer from the SQL pattern (same regex syntax in Postgres)", () => {
    const titles = ["CFPB finalizes rule on overdraft fees", "Bill would ban junk fees", "Debit card interchange", "Treatment of ATMs"];
    for (const fee of ["overdraft", "other", "card", "atm"] as const) {
      const { include, exclude } = feeTypeSql(fee);
      const sqlMatch = (t: string) => new RegExp(include, "i").test(t) && !(exclude && new RegExp(exclude, "i").test(t));
      for (const t of titles) expect(sqlMatch(t)).toBe(feeTypesOf(t).includes(fee));
    }
    expect(parseFeeType("wire")).toBe("wire");
    expect(parseFeeType("nope")).toBeUndefined();
  });
});
