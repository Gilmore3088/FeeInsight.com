import { describe, expect, it } from "vitest";
import { REREAD_MAX_KNOX_FEES } from "./rosetta/read";
import { KNOX_REEXTRACT_MAX_FEES } from "./knox/extract";
import { DOCUMENT_KIND_VERSION } from "./learning/document-kind";
import { feesSentToDarwinSql, isThinDocument, THIN_DOCUMENT_MAX_FEES, thinRereadKindSql } from "./thin-document";

describe("one thin-document test (#1095)", () => {
  it("counts only Knox rows sent to Darwin, so a page of held lines is thin", () => {
    const sqlText = feesSentToDarwinSql("adt.source_document_id");
    expect(sqlText).toContain("needs_darwin_verification");
    expect(sqlText).toContain("thin_fr.source_document_id = adt.source_document_id");
    // Five held lines and nothing sent to Darwin: thin.
    expect(isThinDocument(0)).toBe(true);
    expect(isThinDocument(THIN_DOCUMENT_MAX_FEES)).toBe(false);
  });

  it("is the threshold Rosetta's re-read and Knox's re-extract both use", () => {
    expect(REREAD_MAX_KNOX_FEES).toBe(THIN_DOCUMENT_MAX_FEES);
    expect(KNOX_REEXTRACT_MAX_FEES).toBe(THIN_DOCUMENT_MAX_FEES);
  });

  it("exempts a thin product page by its stored kind, and treats a text with no kind as before (#1094)", () => {
    expect(thinRereadKindSql("adt")).toBe(
      `(adt.document_kind IS NULL OR adt.document_kind NOT IN ('product_page') OR adt.document_kind_version IS DISTINCT FROM ${DOCUMENT_KIND_VERSION})`,
    );
  });

  it("exempts only a kind decided at the current kind version (review of #1457)", () => {
    // The rule, evaluated for one text the way Postgres would.
    const exempt = (kind: string | null, version: number | null) =>
      !(kind == null || !["product_page"].includes(kind) || version !== DOCUMENT_KIND_VERSION);
    expect(exempt("product_page", DOCUMENT_KIND_VERSION)).toBe(true);
    expect(exempt("product_page", DOCUMENT_KIND_VERSION - 1)).toBe(false);
    expect(exempt("product_page", null)).toBe(false);
    expect(exempt("fee_schedule", DOCUMENT_KIND_VERSION)).toBe(false);
    expect(exempt(null, null)).toBe(false);
    // The SQL names the current version, so a bump ends every older exemption.
    expect(thinRereadKindSql("t")).toContain(`t.document_kind_version IS DISTINCT FROM ${DOCUMENT_KIND_VERSION}`);
  });
});
