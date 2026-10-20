import { describe, expect, it } from "vitest";
import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";
import { internationalPublicationPolicy, type InternationalPublicationFacts } from "./international-publication-policy";

const line = (name: string, amount: number, text = `${name} | $${amount}`): InternationalPublicationFacts => ({
  category: "wire_intl_outgoing", name, amount, frequency: "per_item", audience: "unknown", product: null,
  sourceUrl: "https://example.invalid/consumer-fees", sourceLine: text, sourced: true,
  scope: sourceOwnedWireScope(text, name, amount),
});
const fresh = () => line("International Wire Outgoing", 45);
const old = () => ({ ...line("International Wire Transfer Fee", 35), publishedId: 10 });

describe("nonsettling international publication policy (#2278)", () => {
  it("defers an actual directionless35 peer without inventing a new price or settling history", () => {
    expect(internationalPublicationPolicy(fresh(), [old()])).toEqual({ kind: "deferred", reason: "live_scope_conflict", conflictingPublishedIds: [10] });
    expect(internationalPublicationPolicy(fresh(), [])).toEqual({ kind: "ready" });
  });
  it("also defers an already verified generic or wrong-direction candidate", () => {
    expect(internationalPublicationPolicy(old(), [])).toMatchObject({ kind: "deferred", reason: "candidate_scope_unproven" });
    expect(internationalPublicationPolicy({ ...fresh(), category: "wire_intl_incoming" }, [])).toMatchObject({ kind: "deferred", reason: "candidate_scope_unproven" });
    expect(internationalPublicationPolicy({ ...fresh(), sourced: false }, [])).toMatchObject({ kind: "deferred", reason: "candidate_scope_unproven" });
  });
  it("does not create a category-wide different-price or tier restriction", () => {
    const explicit = { ...line("International Wire Outgoing", 35), publishedId: 11 };
    expect(internationalPublicationPolicy(fresh(), [explicit])).toEqual({ kind: "ready" });
    expect(internationalPublicationPolicy(fresh(), [{ ...old(), amount: 45 }])).toEqual({ kind: "ready" });
    expect(internationalPublicationPolicy(fresh(), [{ ...old(), category: "wire_intl_incoming" }])).toEqual({ kind: "ready" });
  });
  it("keeps represented product and audience identities distinct", () => {
    expect(internationalPublicationPolicy({ ...fresh(), product: "Member Checking" }, [old()])).toEqual({ kind: "ready" });
    expect(internationalPublicationPolicy({ ...fresh(), product: "Member Checking" }, [{ ...old(), product: " member checking " }])).toMatchObject({ kind: "deferred" });
    expect(internationalPublicationPolicy({ ...fresh(), audience: "consumer" }, [{ ...old(), audience: "business" }])).toEqual({ kind: "ready" });
    expect(internationalPublicationPolicy({ ...fresh(), audience: "consumer" }, [{ ...old(), audience: "both" }])).toMatchObject({ kind: "deferred" });
  });
  it("uses existing market eligibility, without changing frequencies or comparison arithmetic", () => {
    expect(internationalPublicationPolicy(fresh(), [{ ...old(), frequency: "hourly" }])).toEqual({ kind: "ready" });
    expect(internationalPublicationPolicy(fresh(), [{ ...old(), sourceUrl: "https://example.invalid/business-fees" }])).toEqual({ kind: "ready" });
    expect(internationalPublicationPolicy({ ...fresh(), category: "wire_domestic_outgoing" }, [old()])).toEqual({ kind: "not_applicable" });
  });
  it("cannot treat an unavailable original peer witness as clearance", () => {
    expect(internationalPublicationPolicy(fresh(), [{ ...old(), scope: { kind: "unresolved", reason: "missing_owner" } }])).toMatchObject({ kind: "deferred" });
  });
});
