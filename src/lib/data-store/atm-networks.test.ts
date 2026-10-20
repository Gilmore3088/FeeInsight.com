import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.fn();
vi.mock("./connection", () => {
  const sql = Object.assign((...args: unknown[]) => sqlMock(...args), { unsafe: (s: string) => s });
  return { getSql: vi.fn(), sql };
});

import { getAtmNetworkMentions } from "./atm-networks";
import { institutionDisplayName } from "@/lib/institution-display-name";

describe("getAtmNetworkMentions", () => {
  beforeEach(() => sqlMock.mockReset());

  it("reads the consumer out-of-network ATM lines that name a network, and shapes them", async () => {
    sqlMock.mockResolvedValue([
      { institution_id: 7, institution_name: "EXAMPLE FEDERAL CREDIT UNION", state_code: "MI", fee_name: "Non-CO-OP ATM Fee", amount: "1.00", conditions: null, waiver_text: null, document_url: "https://example.org/a.pdf" },
    ]);
    const out = await getAtmNetworkMentions();
    const query = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(query).toContain("FROM published_fee_catalog ef");
    expect(query).toContain("ef.fee_category = 'atm_non_network'");
    expect(query).toMatch(/concat_ws\(' ', ef\.fee_name, ef\.conditions, ef\.waiver_text\)/);
    // The audience boundary and the business-line rule are passed in through sql.unsafe.
    const params = sqlMock.mock.calls[0].slice(1).join(" ");
    expect(params).toContain("fee_audience IN ('consumer', 'both', 'unknown')");
    expect(params).toMatch(/commercial\|business\|corporate/);
    expect(query).not.toMatch(/institution_network_memberships|osm_financial_locations|extracted_fees/);

    const coop = out.find((n) => n.id === "coop")!;
    expect(coop.institutions).toHaveLength(1);
    expect(coop.institutions[0].lines[0]).toEqual({ feeName: "Non-CO-OP ATM Fee", amount: 1, namedIn: null, documentUrl: "https://example.org/a.pdf" });
    expect(coop.institutions[0].name).toBe(institutionDisplayName("EXAMPLE FEDERAL CREDIT UNION"));
  });
});
