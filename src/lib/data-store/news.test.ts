import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: {}, withTransaction: vi.fn() }));

import { ENFORCEMENT_TITLE, FEDERAL_RELEASES_ONLY, TOPIC_SQL, buildArticleFilter, classify, isEnforcementTitle } from "./news";

describe("federal release filter", () => {
  it("always keeps to federal releases", () => {
    expect(buildArticleFilter()).toEqual({ where: `WHERE ${FEDERAL_RELEASES_ONLY}`, params: [] });
  });

  it("numbers each value as a bind parameter, search last", () => {
    const { where, params } = buildArticleFilter({ source: "OCC", topic: "general", since: "2026-10-01T00:00:00.000Z", q: "fraud" });
    expect(where).toBe(
      `WHERE ${FEDERAL_RELEASES_ONLY} AND source = $1 AND ${TOPIC_SQL} = $2 AND published_at >= $3 AND title ILIKE $4`,
    );
    expect(params).toEqual(["OCC", "general", "2026-10-01T00:00:00.000Z", "%fraud%"]);
  });

  it("keeps search text out of the SQL and escapes LIKE wildcards", () => {
    const { where, params } = buildArticleFilter({ q: "50%'; DROP TABLE reg_articles; --" });
    expect(where).toBe(`WHERE ${FEDERAL_RELEASES_ONLY} AND title ILIKE $1`);
    expect(params).toEqual(["%50\\%'; DROP TABLE reg\\_articles; --%"]);
  });

  it("filters by fee type with bound regex patterns, excluding specific types for other fees", () => {
    const overdraft = buildArticleFilter({ fee: "overdraft" });
    expect(overdraft.where).toBe(`WHERE ${FEDERAL_RELEASES_ONLY} AND title ~* $1`);
    expect(overdraft.params[0]).toContain("overdraft");
    const other = buildArticleFilter({ q: "bank", fee: "other" });
    expect(other.where).toBe(`WHERE ${FEDERAL_RELEASES_ONLY} AND title ILIKE $1 AND title ~* $2 AND title !~* $3`);
    expect(other.params).toHaveLength(3);
  });

  it("ignores a blank search", () => {
    expect(buildArticleFilter({ q: "   " }).params).toEqual([]);
  });
});

describe("classify", () => {
  it("files enforcement actions and their terminations as Enforcement, not Rulemaking", () => {
    expect(classify("Federal Reserve Board announces termination of enforcement actions with Example Bancorp")).toBe("enforcement");
    expect(classify("OCC issues consent order against Example Bank, N.A.")).toBe("enforcement");
    expect(classify("Agencies issue final rule on overdraft fees")).toBe("overdraft");
    expect(classify("CFPB issues consent order over overdraft fees")).toBe("overdraft");
    expect(classify("Agencies request comment on proposed rule")).toBe("rulemaking_compliance");
  });

  it("files an enforcement release naming an acquisition company, or a settlement, as Enforcement (A4)", () => {
    expect(classify("Federal Reserve Board announces termination of enforcement actions with United Texas Bank, Quontic Bank Acquisition Corp., and Quontic Bank Holdings Corp.")).toBe("enforcement");
    expect(classify("CFPB Reaches Settlement with FirstCash, Inc. and Its Subsidiaries for Military Lending Act Violations")).toBe("enforcement");
    expect(classify("Federal Reserve Board announces approval of application by Example Bancorp")).toBe("mergers_acquisitions");
    expect(classify("CFPB reaches settlement with Example Bank over overdraft fees")).toBe("overdraft");
  });

  it("counts a settlement as Enforcement only when a regulator settles (A4 review)", () => {
    const swipe = "Visa and Mastercard reach settlement with merchants over swipe fees";
    expect(classify(swipe)).toBe("general");
    expect(classify(swipe, "news:NY")).toBe("general");
    // Press coverage of a private settlement stays General; of a regulator's, it is Enforcement.
    expect(classify("Example Bank reaches settlement with former employees", "news:TX")).toBe("general");
    expect(classify("Texas Department of Banking reaches settlement with Example Lender", "news:TX")).toBe("enforcement");
    expect(classify("State attorney general announces settlement with payday lender", "news:OH")).toBe("enforcement");
    expect(classify("CFPB Reaches Settlement with FirstCash, Inc. and Its Subsidiaries for Military Lending Act Violations", "CFPB")).toBe("enforcement");
    // A regulator's own post needs no regulator in the title.
    expect(classify("Commissioner announces settlement with Example Mortgage Company", "state:CA")).toBe("enforcement");
    expect(classify("Settlement with Example Bancorp announced", "FED")).toBe("enforcement");
    expect(classify("Commissioner announces settlement with Example Mortgage Company", "news:CA")).toBe("general");
    // "Fed" and "OCC" count only as whole words.
    expect(isEnforcementTitle("Soccer club reaches settlement with sponsor", "news:FL")).toBe(false);
    expect(isEnforcementTitle("Federal Reserve Board reaches settlement with Example Bank")).toBe(true);
  });

  it("does not read a bare \"dfs\" or a hyphenated \"Fed-\" as a regulator (A4 review)", () => {
    expect(isEnforcementTitle("DFS Furniture reaches settlement with landlord", "news:NY")).toBe(false);
    expect(isEnforcementTitle("Fed-up customers reach settlement with Example Bank", "news:TX")).toBe(false);
    expect(isEnforcementTitle("NYDFS reaches settlement with Example Bank", "news:NY")).toBe(true);
    expect(isEnforcementTitle("New York DFS reaches settlement with Example Bank", "news:NY")).toBe(true);
    expect(isEnforcementTitle("NY DFS announces settlement with Example Bank", "news:NY")).toBe(true);
    expect(isEnforcementTitle("New York Department of Financial Services announces settlement with Example Lender", "news:NY")).toBe(true);
    expect(isEnforcementTitle("Fed, OCC reach settlement with Example Bank", "news:DC")).toBe(true);
    // The stored-row SQL inlines the same pattern, so the two rules cannot drift apart.
    expect(TOPIC_SQL).not.toMatch(/[|(]dfs[|)]/);
    expect(TOPIC_SQL).toContain("([^a-z-]|$)");
  });

  it("files the Fed's written agreements as Enforcement", () => {
    expect(classify("Federal Reserve Board announces execution of written agreement with Example Bancorp", "FED")).toBe("enforcement");
    expect(classify("Federal Reserve Board announces termination of written agreement with Example Bank", "FED")).toBe("enforcement");
  });

  it("reads stored rows by the same enforcement rule", () => {
    expect(TOPIC_SQL).toContain("'enforcement'");
    expect(TOPIC_SQL).toContain("'mergers_acquisitions'");
    expect(TOPIC_SQL).not.toContain("'overdraft'");
    expect(TOPIC_SQL).not.toMatch(/\$\d/);
    // The pattern is inlined into a quoted SQL literal: plain words only.
    expect(ENFORCEMENT_TITLE.source).toMatch(/^[a-z |]+$/);
    // The settlement rule reads the row's source, and its patterns hold no quote or backslash.
    expect(TOPIC_SQL).toContain("source LIKE 'state:%'");
    expect(TOPIC_SQL).not.toContain("'news:");
    expect(TOPIC_SQL).not.toMatch(/\\/);
    expect(TOPIC_SQL.match(/'/g)!.length % 2).toBe(0);
  });
});
