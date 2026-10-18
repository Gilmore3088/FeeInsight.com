import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: {}, withTransaction: vi.fn() }));

import { FEDERAL_RELEASES_ONLY, TOPIC_SQL, buildArticleFilter, classify } from "./news";

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
    expect(classify("Agencies request comment on proposed rule")).toBe("rulemaking_compliance");
  });

  it("reads stored rows by the same enforcement rule", () => {
    expect(TOPIC_SQL).toContain("'enforcement'");
    expect(TOPIC_SQL).not.toMatch(/\$\d/);
  });
});
