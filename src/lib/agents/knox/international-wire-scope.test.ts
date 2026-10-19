// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceOwnedWireScope, reviewInternationalDirection } from "@/lib/custom-report/own-wire-scope";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { refileCategory, refileFromLine } from "@/lib/fee-category-guard";
import { groundPaidRow } from "./paid-extract";
import { runFreeSpecialists } from "./specialists";
import { internationalWireEligibility, requiresInternationalWireSource } from "./international-wire-eligibility";

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/family-international-wire-scope.json", import.meta.url), "utf8"));
const pdf = fixture.sources.find((row: { kind: string }) => row.kind === "consumer_pdf");
const html = fixture.sources.find((row: { kind: string }) => row.kind === "fresh_html");

describe("source-owned international wire scope, independent of price admission (#2278)", () => {
  it("keeps all four exact PDF wire prices and the incoming domestic-hint refile", () => {
    expect(createHash("sha256").update(pdf.normalizedText).digest("hex")).toBe(pdf.normalizedTextSHA256);
    expect(pdf.sourceBytesSHA256).toBe("d978a0178d3d8063f8d99c41f508f69135578dbabab1af980836d27b09009cc9");
    const wires = runFreeSpecialists(pdf.normalizedText).candidates.filter(row => row.canonicalHint.startsWith("wire_"));
    expect(wires.map(row => row.amount)).toEqual([10, 20, 35, 45]);
    for (const row of wires) {
      const resolved = refileFromLine(row.canonicalHint, row.feeName, { amount: row.amount, conditions: `excerpt="${row.excerpt}"` })
        ?? refileCategory(row.canonicalHint, row.feeName);
      const scope = sourceOwnedWireScope(pdf.normalizedText, row.feeName, row.amount);
      expect(scope.kind, row.feeName).toBe("owned");
      expect(checkFeeAgainstSource(pdf.normalizedText, row.feeName, row.amount, ".", resolved).ok).toBe(true);
      expect(reviewInternationalDirection(scope, resolved).kind).toBe(row.amount < 30 ? "not_applicable" : "admit");
      if (row.amount === 35) {
        expect(row.canonicalHint).toBe("wire_domestic_incoming");
        expect(resolved).toBe("wire_intl_incoming");
        expect(scope).toMatchObject({ geography: "international", directions: ["incoming"] });
      }
    }
  });

  it("does not borrow nearby outgoing45 for the HTML generic35 row", () => {
    expect(createHash("sha256").update(html.normalizedText).digest("hex")).toBe(html.normalizedTextSHA256);
    const scope = sourceOwnedWireScope(html.normalizedText, "International Wire Transfer Fee", 35);
    expect(scope).toMatchObject({ kind: "owned", geography: "international", directions: [] });
    expect(reviewInternationalDirection(scope, "wire_intl_outgoing")).toMatchObject({ kind: "hold", reason: "direction_missing" });
    expect(checkFeeAgainstSource(html.normalizedText, "International Wire Transfer Fee", 35, ".", "wire_intl_outgoing").ok).toBe(true);
    const free = runFreeSpecialists(html.normalizedText);
    expect(free.candidates.some(row => row.canonicalHint === "wire_intl_outgoing" && row.amount === 35)).toBe(false);
    expect(free.held).toContainEqual(expect.objectContaining({ shape: "eligibility", feeName: "International Wire Transfer Fee",
      amount: 35, excerpt: "International Wire Transfer Fee | $35.00", ownedPolicy: true }));
  });

  it("uses the existing resolved key before a caller's source requirement", () => {
    const candidate = { feeName: "International Wire Incoming", amount: 35, canonicalHint: "wire_domestic_incoming", excerpt: "International Wire Incoming $35" };
    expect(requiresInternationalWireSource(candidate)).toBe(true);
    expect(internationalWireEligibility(pdf.normalizedText, candidate)).toMatchObject({ kind: "admit" });
    expect(requiresInternationalWireSource({ ...candidate, feeName: "Named Member Wire Incoming" })).toBe(false);
    expect(internationalWireEligibility("unrepresented source", { ...candidate, feeName: "Named Member Wire Incoming" })).toEqual({ kind: "not_applicable" });
  });

  it("does not refile a supplied wrong incoming key from a model claim", () => {
    const candidate = { feeName: "International Wire Outgoing", amount: 45, canonicalHint: "wire_intl_incoming", excerpt: "incoming claim" };
    expect(internationalWireEligibility(pdf.normalizedText, candidate)).toMatchObject({ kind: "hold", reason: "direction_mismatch" });
  });

  it("keeps new international admission separate from unchanged price support", () => {
    const candidate = { feeName: "International Wire Transfer Fee", amount: 35, canonicalHint: "wire_intl_outgoing", excerpt: "incoming" };
    expect(checkFeeAgainstSource(html.normalizedText, candidate.feeName, 35, ".", candidate.canonicalHint).ok).toBe(true);
    expect(internationalWireEligibility(html.normalizedText, candidate)).toMatchObject({ kind: "hold", reason: "direction_missing" });
    expect(internationalWireEligibility("International Wire Incoming | $35", candidate)).toMatchObject({ kind: "decline", reason: "missing_owner" });
  });

  it.each(["Free", "No Charge", "No Fee"])("retains factual own scope for an already admitted zero marker %s", marker => {
    const text = `Incoming International Wire | ${marker}`;
    expect(checkFeeAgainstSource(text, "Incoming International Wire", 0, ".", "wire_intl_incoming").ok).toBe(true);
    expect(typeof groundPaidRow({ fee_name: "Incoming International Wire", amount: 0,
      canonical_key: "wire_intl_incoming", source_line: text }, text)).toBe("object");
    expect(sourceOwnedWireScope(text, "Incoming International Wire", 0)).toMatchObject({ kind: "owned", geography: "international", directions: ["incoming"] });
    expect(sourceOwnedWireScope(text, "Incoming International Wire", 35)).toMatchObject({ kind: "unresolved" });
  });

  it("preserves a complete dot-leader zero and a bounded explicit wire heading", () => {
    expect(sourceOwnedWireScope("Wire-International Incoming ........ No Charge", "Wire-International Incoming", 0)).toMatchObject({ kind: "owned", directions: ["incoming"] });
    expect(sourceOwnedWireScope("Wire Transfers\nDomestic Incoming | Free\nInternational Incoming | No Charge", "Wire Transfers: International Incoming", 0))
      .toMatchObject({ kind: "owned", geography: "international", directions: ["incoming"] });
  });

  it.each(["No Charge if account qualifies", "No Charge | Unlimited", "Free / No Fee"])("declines unsupported zero-marker tails rather than inferring eligibility: %s", price => {
    expect(sourceOwnedWireScope(`Incoming International Wire | ${price}`, "Incoming International Wire", 0)).toMatchObject({ kind: "unresolved", reason: "unsupported_shape" });
  });

  it("does not borrow a neighboring zero marker or choose repeated free owners", () => {
    expect(sourceOwnedWireScope("Incoming International Wire | $35\nOutgoing International Wire | Free", "Incoming International Wire", 0)).toMatchObject({ kind: "unresolved" });
    expect(sourceOwnedWireScope("Incoming International Wire | Free\nIncoming International Wire | No Charge", "Incoming International Wire", 0)).toMatchObject({ kind: "unresolved", reason: "ambiguous_owner" });
  });

  it("validates a previously admitted literal international slash clause without creating its price", () => {
    const scope = sourceOwnedWireScope(html.normalizedText, "Outgoing International Wire Transfer Fees", 45);
    expect(scope).toMatchObject({ kind: "owned", geography: "international", directions: ["outgoing"] });
    expect(reviewInternationalDirection(scope, "wire_intl_outgoing").kind).toBe("admit");
    // Existing domestic-only free admission remains outside this pure helper.
    expect(runFreeSpecialists(html.normalizedText).candidates.some(row => row.amount === 45)).toBe(false);
  });

  it("distinguishes accepted paid price support from a wrong claimed direction", () => {
    const quote = "International Wire Outgoing $45 | FEE SCHEDULE & ACCOUNT DISCLOSURE";
    const paid = groundPaidRow({ fee_name: "International Wire Outgoing", amount: 45, canonical_key: "wire_intl_incoming", source_line: quote }, pdf.normalizedText);
    expect(typeof paid).toBe("object");
    const scope = sourceOwnedWireScope(pdf.normalizedText, "International Wire Outgoing", 45);
    expect(reviewInternationalDirection(scope, "wire_intl_incoming")).toMatchObject({ kind: "hold", reason: "direction_mismatch" });
    const wrongName = sourceOwnedWireScope(pdf.normalizedText, "International Wire Incoming", 45);
    expect(wrongName).toEqual({ kind: "unresolved", reason: "missing_owner" });
    expect(reviewInternationalDirection(wrongName, "wire_intl_incoming").kind).toBe("decline");
  });

  it.each([
    ["Incoming Wire Transfers\nInternational | $35.00", "Incoming Wire Transfers: International", 35, "incoming"],
    ["Incoming Wire Transfers\nDomestic | $10.00\nInternational | $35.00", "Incoming Wire Transfers: International", 35, "incoming"],
    ["Outgoing Wire Transfers\nInternational | $45.00", "Outgoing Wire Transfers: International", 45, "outgoing"],
    ["International Wire-In | $35.00", "International Wire-In", 35, "incoming"],
    ["International Wire Outbound | $45.00", "International Wire Outbound", 45, "outgoing"],
    ["International Wire Fee | $35.00 on incoming wires", "International Wire Fee", 35, "incoming"],
  ] as const)("binds bounded literal own direction: %s", (text, name, amount, direction) => {
    expect(sourceOwnedWireScope(text, name, amount)).toMatchObject({ kind: "owned", geography: "international", directions: [direction] });
  });

  it.each([
    ["International Wire Incoming | $35\nInternational Wire Outgoing | $35", "International Wire Incoming", "incoming"],
    ["International Wire Outgoing | $35\nInternational Wire Incoming | $35", "International Wire Outgoing", "outgoing"],
  ] as const)("retains separately named equal-price direction owners", (text, name, direction) => {
    expect(sourceOwnedWireScope(text, name, 35)).toMatchObject({ kind: "owned", directions: [direction] });
  });

  it("requires literal both-direction and shared-geography clauses", () => {
    const both = sourceOwnedWireScope("Incoming/Outgoing International Wire Fee | $35", "Incoming/Outgoing International Wire Fee", 35);
    expect(both).toMatchObject({ kind: "owned", geography: "international", directions: ["incoming", "outgoing"] });
    const shared = sourceOwnedWireScope("Domestic & International Incoming Wires | $35", "Domestic & International Incoming Wires", 35);
    expect(shared).toMatchObject({ kind: "owned", geography: "shared", directions: ["incoming"] });
    expect(reviewInternationalDirection(shared, "wire_intl_incoming").kind).toBe("admit");
  });

  it.each([
    ["Incoming Wires | $10\nInternational Wire Fee | $35", "International Wire Fee", "direction_missing"],
    ["Incoming Wires\nContact us about our services\nInternational Wire Fee | $35", "International Wire Fee", "direction_missing"],
    ["International Wire Fee | $35\nOutgoing Wires | $45", "International Wire Fee", "direction_missing"],
    ["Wire Incoming | $35", "Wire Incoming", "geography_missing"],
    ["Domestic Wire Incoming | $35", "Domestic Wire Incoming", "geography_mismatch"],
  ] as const)("does not infer missing scope from neighbors or a supplied key", (text, name, reason) => {
    expect(reviewInternationalDirection(sourceOwnedWireScope(text, name, 35), "wire_intl_incoming")).toMatchObject({ kind: "hold", reason });
  });

  it.each([
    ["International Wire Fee | $35\nInternational Wire Fee | $35", "ambiguous_owner"],
    ["Incoming Wires\nInternational Wire Fee | $35\nOutgoing Wires\nInternational Wire Fee | $35", "ambiguous_owner"],
    ["International Wire Fee | $35 / $45", "unsupported_shape"],
    ["International Wire Fee | $35 or 1%", "unsupported_shape"],
    ["International Wire Fee | $35 ask about incoming options", "unsupported_shape"],
    ["International Wire Fee | $35\nInternational Wire Fee | $45", null],
  ] as const)("is conservative about repeated/unsupported ownership: %s", (text, reason) => {
    const scope = sourceOwnedWireScope(text, "International Wire Fee", 35);
    if (reason) expect(scope).toEqual({ kind: "unresolved", reason });
    else expect(scope).toMatchObject({ kind: "owned", directions: [] });
  });

  it("does not merge contradictory heading geography into shared scope", () => {
    expect(sourceOwnedWireScope("Domestic Incoming Wires\nInternational | $35", "Domestic Incoming Wires: International", 35))
      .toEqual({ kind: "unresolved", reason: "unsupported_shape" });
  });

  it.each([
    ["Wire Transfers\nDomestic Incoming ........ $15.00 per wire\nInternational Incoming ........ $15.00 per wire\nDomestic Outgoing (client only) ........ $25.00 per wire\nInternational Outgoing (client only) ........ $45.00 per wire", "International Outgoing (client only) wire", 45],
    ["Wire Transfers\nDomestic\nIncoming ........ $15.00\nOutgoing ........ $30.00\nInternational\nUSD Outgoing ........ $40.00\nForeign Currency Outgoing ........ $25.00", "International Wire Transfers: USD Outgoing", 40],
    ["Wire Transfers\nIncoming Domestic\n$15.00\nOutgoing International\n$45.00\nDormant Account Fee\nGift Cards\n$3.50", "Wire Transfers: Outgoing International", 45],
    ["Wire Transfer (outgoing)........\n$20.00 Wire Transfer Agreement (WPIN) Replacement Fee ........\n$10.00 Outgoing International Wire (in foreign currency) ........\n$50.00 Garnishments ........\n$100.00 Levies ........\n$20.00", "Outgoing International Wire (in foreign currency)", 50],
    ["Money Orders | $5.00 per item | Multiple fees will not be assessed for any item identified as previously\nWire Transfer Fees | being returned NSF.\nDomestic Outgoing | $35.00 per wire | 10. Account type no longer offered.\nInternational Outgoing | $50.00 per wire | 11. Service assisted refers to transactions processed with bank staff.", "Wire Transfer Fees: International Outgoing", 50],
  ] as const)("preserves existing literal directed physical geometry: %s", (text, name, amount) => {
    expect(sourceOwnedWireScope(text, name, amount)).toMatchObject({ kind: "owned", geography: "international", directions: ["outgoing"] });
    expect(reviewInternationalDirection(sourceOwnedWireScope(text, name, amount), "wire_intl_outgoing").kind).toBe("admit");
  });

  it.each([
    ["Wire Transfers\nNotes about wires follow\nmore notes\nmore notes\nmore notes\nmore notes\nInternational\nOutgoing ........ $40.00", "International Wire Transfers: Outgoing", 40],
    ["Wire Transfers\nInternational\nGift Cards\nOutgoing | $40", "International Wire Transfers: Outgoing", 40],
    ["Outgoing International\nIncoming International\n$45.00", "Outgoing International", 45],
    ["Outgoing International Wire ........\n$50.00\nOutgoing International Wire ........\n$50.00", "Outgoing International Wire", 50],
    ["$10.00 Outgoing International Wire ........\n$50.00 Garnishments ........", "Outgoing International Wire", 10],
    ["International Incoming ........ $15.00 per item", "International Incoming wire", 15],
  ] as const)("does not extend those layouts across missing owners or unrelated boundaries: %s", (text, name, amount) => {
    expect(sourceOwnedWireScope(text, name, amount).kind).toBe("unresolved");
  });

  it("can bind an explicit literal zero without inferring a price from scope", () => {
    expect(reviewInternationalDirection(sourceOwnedWireScope("International Wire Incoming | $0", "International Wire Incoming", 0), "wire_intl_incoming").kind).toBe("admit");
    expect(sourceOwnedWireScope("International Wire Incoming", "International Wire Incoming", 0).kind).toBe("unresolved");
  });

  it.each([
    ["Premier Account Domestic Wire | $25 / $30", "Premier Account Domestic Wire", 25],
    ["Wire service under a named product, ask for the applicable price", "Wire service", 25],
    ["Domestic Wire Fee | $25 or 1%", "Domestic Wire Fee", 25],
  ] as const)("does not make this finite resolver a new domestic admission requirement", (text, name, amount) => {
    const scope = sourceOwnedWireScope(text, name, amount);
    expect(scope.kind).toBe("unresolved");
    expect(reviewInternationalDirection(scope, "wire_domestic_outgoing")).toEqual({ kind: "not_applicable" });
    expect(reviewInternationalDirection(scope, "wire_domestic_incoming")).toEqual({ kind: "not_applicable" });
  });

  it("still holds positively owned international scope under an unresolved domestic final category", () => {
    const scope = sourceOwnedWireScope("International Wire Incoming | $35", "International Wire Incoming", 35);
    expect(reviewInternationalDirection(scope, "wire_domestic_incoming")).toMatchObject({ kind: "hold", reason: "category_mismatch" });
  });
});
