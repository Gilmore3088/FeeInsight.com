import { describe, expect, it } from "vitest";
import { PublicationEvidenceUnavailable, publicationEvidenceValue, readPublicationEvidence } from "./publication-evidence";

describe("Publication evidence availability", () => {
  it("distinguishes successful empty values from an unavailable query", async () => {
    expect(await readPublicationEvidence("exact_duplicate", async () => [])).toEqual({ state: "available", value: [] });
    expect(await readPublicationEvidence("page_copy_live", async () => null)).toEqual({ state: "available", value: null });
    expect(await readPublicationEvidence("live_prior", async () => { throw new Error("SQL/source/stack secret"); }))
      .toEqual({ state: "unavailable", check: "live_prior" });
  });

  it("does not inspect arbitrary thrown objects while projecting a fixed read code", async () => {
    const hostile = new Proxy({}, { get() { throw new Error("getter must not run"); }, getPrototypeOf() { throw new Error("prototype must not run"); } });
    expect(await readPublicationEvidence("document_text", async () => { throw hostile; }))
      .toEqual({ state: "unavailable", check: "document_text" });
  });

  it("cannot silently use the historical fallback for a required publisher read", () => {
    const unavailable = { state: "unavailable", check: "listed_fee_lines" } as const;
    expect(() => publicationEvidenceValue(unavailable, [], true)).toThrow(PublicationEvidenceUnavailable);
    expect(() => publicationEvidenceValue(unavailable, [], true)).toThrow("Publication evidence unavailable: listed_fee_lines");
    expect(publicationEvidenceValue(unavailable, [])).toEqual([]);
    expect(publicationEvidenceValue({ state: "available", value: [] }, [1], true)).toEqual([]);
  });
});
