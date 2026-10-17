import { describe, expect, it, vi } from "vitest";

import { eventKeyOf, fetchFdicHistoryYear, historyDate, normalizeHistoryRecord } from "./fdic-history";

describe("FDIC history parsing", () => {
  it("reads the date shapes BankFind uses", () => {
    expect(historyDate("2026-03-31")).toBe("2026-03-31");
    expect(historyDate("2026-03-31T00:00:00")).toBe("2026-03-31");
    expect(historyDate("3/1/2026")).toBe("2026-03-01");
    expect(historyDate("")).toBeNull();
  });

  it("keys a record by its id, else by its content", () => {
    expect(eventKeyOf({ ID: "abc" })).toBe("id:abc");
    expect(eventKeyOf({ CERT: 1, EFFDATE: "x" })).toBe(eventKeyOf({ EFFDATE: "x", CERT: 1 }));
  });

  it("maps a merger record and keeps the raw record", () => {
    const e = normalizeHistoryRecord({ CERT: 628, INSTNAME: "Bank A", CHANGECODE: 223, EFFDATE: "2025-07-01", ACQ_CERT: 3510 });
    expect(e).toMatchObject({ cert: "628", changeCode: "223", effectiveDate: "2025-07-01", acquirerCert: "3510", officeNumber: null });
    expect(e.raw.INSTNAME).toBe("Bank A");
  });
});

describe("fetchFdicHistoryYear", () => {
  it("filters on the year and reports fields no record carried", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ meta: { total: 1 }, data: [{ data: { CERT: 1, CHANGECODE: 1, EFFDATE: "2025-02-01" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const year = await fetchFdicHistoryYear(2025, { fetchImpl, backoffMs: 0 });
    const url = new URL(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(url.searchParams.get("filters")).toBe('EFFDATE:["2025-01-01" TO "2025-12-31"]');
    expect(year).toMatchObject({ total: 1, truncated: false });
    expect(year.missingFields).toContain("OFF_NUM");
    expect(year.missingFields).not.toContain("CERT");
  });
});
