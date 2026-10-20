import { describe, expect, it } from "vitest";
import { buildNetworkMentions, isEmptyNetworkMentions, networksNamed, type NetworkFeeRow } from "./atm-networks";

function row(overrides: Partial<NetworkFeeRow>): NetworkFeeRow {
  return {
    institution_id: 1,
    institution_name: "Example CU",
    state_code: "TX",
    fee_name: "ATM fee",
    amount: 1,
    conditions: null,
    waiver_text: null,
    document_url: "https://example.org/fees.pdf",
    ...overrides,
  };
}

describe("networksNamed", () => {
  it("finds each network as schedules spell it", () => {
    expect(networksNamed("Non-CO-OP ATM Fee")).toEqual(["coop"]);
    expect(networksNamed("ATM Transaction Fee (Non Co-op/Jeanie Machine)")).toEqual(["coop"]);
    expect(networksNamed("Free at coop ATMs")).toEqual(["coop"]);
    expect(networksNamed("MoneyPass ATM withdrawal")).toEqual(["moneypass"]);
    expect(networksNamed("Money Pass network")).toEqual(["moneypass"]);
    expect(networksNamed("Non UNFCU/Co-op/Allpoint network ATM")).toEqual(["allpoint", "coop"]);
  });

  it("does not read cooperative or co-operative as the CO-OP network", () => {
    expect(networksNamed("Cooperative Bank ATM fee")).toEqual([]);
    expect(networksNamed("Co-operative Credit Union ATM")).toEqual([]);
    expect(networksNamed("Coopers Federal ATM")).toEqual([]);
    expect(networksNamed("Foreign ATM fee")).toEqual([]);
  });
});

describe("buildNetworkMentions", () => {
  it("groups lines by network and institution, keeping each line verbatim with its amount", () => {
    const out = buildNetworkMentions([
      row({ institution_id: 2, institution_name: "B Bank", state_code: "OH", fee_name: "Non-CO-OP ATM Fee", amount: "1.00" }),
      row({ institution_id: 1, institution_name: "A CU", state_code: "AL", fee_name: "Foreign ATM", amount: 2, conditions: "(Allpoint is a non-Connex ATM): then $2.00" }),
      row({ institution_id: 2, institution_name: "B Bank", state_code: "OH", fee_name: "Non-CO-OP ATM Fee", amount: 1 }),
      row({ institution_id: 3, fee_name: "Wire fee", amount: 25 }),
    ]);
    expect(out.map((n) => [n.id, n.institutions.length])).toEqual([
      ["allpoint", 1],
      ["moneypass", 0],
      ["coop", 1],
    ]);
    const coop = out[2].institutions[0];
    expect(coop).toMatchObject({ institutionId: 2, name: "B Bank", state: "OH" });
    // The exact repeat is dropped; the name already names the network, so no schedule text is quoted.
    expect(coop.lines).toEqual([{ feeName: "Non-CO-OP ATM Fee", amount: 1, namedIn: null, documentUrl: "https://example.org/fees.pdf" }]);
    // Named only in the conditions: those words are shown, so naming is never read as membership.
    expect(out[0].institutions[0].lines[0]).toMatchObject({ feeName: "Foreign ATM", amount: 2, namedIn: "(Allpoint is a non-Connex ATM): then $2.00" });
  });

  it("sorts institutions by state then name, and drops rows without a usable amount", () => {
    const out = buildNetworkMentions([
      row({ institution_id: 1, institution_name: "Zed CU", state_code: "AL", fee_name: "CO-OP ATM" }),
      row({ institution_id: 2, institution_name: "Able CU", state_code: "WA", fee_name: "CO-OP ATM" }),
      row({ institution_id: 3, institution_name: "Best CU", state_code: "AL", fee_name: "CO-OP ATM" }),
      row({ institution_id: 4, institution_name: "Bad CU", state_code: "AL", fee_name: "CO-OP ATM", amount: "n/a" }),
      row({ institution_id: 5, institution_name: "Neg CU", state_code: "AL", fee_name: "CO-OP ATM", amount: -1 }),
    ]);
    expect(out[2].institutions.map((i) => i.name)).toEqual(["Best CU", "Zed CU", "Able CU"]);
  });

  it("clips long schedule text at a word", () => {
    const long = `Free at MoneyPass machines ${"and more words ".repeat(30)}`;
    const line = buildNetworkMentions([row({ fee_name: "ATM fee", waiver_text: long })])[1].institutions[0].lines[0];
    expect(line.namedIn!.length).toBeLessThanOrEqual(181);
    expect(line.namedIn).toMatch(/^Free at MoneyPass machines .*…$/);
  });

  it("counts an empty read as empty", () => {
    expect(isEmptyNetworkMentions(buildNetworkMentions([]))).toBe(true);
    expect(isEmptyNetworkMentions(null)).toBe(true);
    expect(isEmptyNetworkMentions(buildNetworkMentions([row({ fee_name: "Allpoint ATM" })]))).toBe(false);
  });
});
