// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownPriceAudience } from "./own-price-audience";
import { darwinAudience } from "./audience";
import { decideAudience, changesAudience, type AudienceRelabelRow } from "./audience-relabel";

const source = readFileSync(new URL("../knox/__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
const row = { fee_audience: "unknown" as const, source_url: "https://bank.example/fee-schedule.pdf", fee_name: "Check Images" };
const optIn = { ownPriceClause: true } as const;
const mixed = (own: string) => `Fee Schedule\n${own}\nBusiness Checking\nMonthly Fee | $5 monthly`;

describe("an exclusive audience on the exact own price clause (#2342)", () => {
  it("binds the complete actual source and preserves the legacy old-red beside the prospective outcome", () => {
    expect(createHash("sha256").update(source).digest("hex"))
      .toBe("dc6eb4136b9e193c6b9c250ba56e74499b1b8d29f3276658e6bdd81af9241ccc");
    expect(darwinAudience(row, 10, source)?.feeAudience).toBe("both");
    expect(ownPriceAudience(source, row.fee_name, 10)).toEqual({
      kind: "qualified",
      audience: "consumer",
      evidence: "Check Images | • $10.00 (Consumer Only) per statement",
    });
    expect(darwinAudience(row, 10, source, optIn)).toEqual({
      feeAudience: "consumer",
      audienceEvidence: "darwin:fee_exclusive_price_clause: Check Images | • $10.00 (Consumer Only) per statement",
    });
  });

  it.each([
    ["Check Images | $10 (Consumer Only) per statement", "consumer"],
    ["Check Images $10 per statement (Personal Only)", "consumer"],
    ["Check Images\n• $10.00 (Business Only) per statement", "business"],
    ["Check Images\n$10 for commercial accounts only", "business"],
    ["Check Images (Consumer Only) | $10 per statement", "consumer"],
    ["Check Images (Business Accounts Only)\n• $10 each statement", "business"],
    ["CHECK IMAGES: $10 Consumer Only", "consumer"],
    ["Check\u00a0Images .... $10 /statement (Consumer Only)", "consumer"],
    ["Check Images | $0 (Consumer Only)", "consumer"],
  ] as const)("reads a bounded physical own occurrence: %s", (text, audience) => {
    const amount = text.includes("$0 ") ? 0 : 10;
    expect(ownPriceAudience(text, row.fee_name, amount)).toMatchObject({ kind: "qualified", audience });
  });

  it.each([
    "Check Images | $10\nOther Service | $10 (Consumer Only)",
    "Other Service | $10 (Consumer Only)\nCheck Images | $10",
    "Check Images\nOther Service\n• $10 (Consumer Only)",
    "Check Images Returned | $10 (Consumer Only)",
    "Returned Check Images | $10 (Consumer Only)",
    "Check Images | $15 (Consumer Only)",
    "Check Images | $10 for copies of personal checks",
    "Check Images | $10 for credit union business only",
    "Check Images | $10 (Consumer and Business)",
    "Check Images | $10 personal / $20 business",
    "Check Images | 10% (Consumer Only)",
    "Check Images | $10\n(Consumer Only)",
  ])("does not borrow or create exclusive evidence: %s", text => {
    expect(ownPriceAudience(text, row.fee_name, 10)).toEqual({ kind: "none" });
  });

  it.each([
    "Check Images | $10 (Consumer Only) | Other Service $20",
    "| Check Images | $10 (Consumer Only) |",
    "Check Images | (Consumer Only) | $10",
    "Check Images\t$10 (Consumer Only)\tOther Service $20",
    "Check Images | $10 (Consumer Only) / $20 (Business Only)",
    "Check Images | $20 (Business Only) / $10 (Consumer Only)",
    "Check Images | $10 (Consumer Only) except business accounts",
    "Check Images | $10 not Consumer Only",
    "Check Images | $10 (Consumer Only",
    "Check Images | $10 (Consumer Only) (Business Only)",
    "Check Images\n• $10 (Consumer Only)\nCheck Images",
    "Check Images | $10 (Consumer Only)\nCheck Images | $10",
    "Check Images | $10\nCheck Images | $10 (Consumer Only)",
    "Check Images | $10 (Consumer Only)\nCheck Images | $10 (Business Only)",
    "Check Images | $10 (Business Only)\nCheck Images | $10 (Consumer Only)",
    "Check Images | $10 (Consumer Only)\nCheck Images | $10 (Consumer Only)",
  ])("blocks broader defaults for unsupported or conflicting own evidence: %s", text => {
    expect(ownPriceAudience(text, row.fee_name, 10)).toMatchObject({ kind: "ambiguous" });
    expect(darwinAudience(row, 10, mixed(text), optIn)).toBeNull();
  });

  it("keeps different explicitly owned price tiers separate without selecting a generic audience", () => {
    const text = "Check Images | $10 (Consumer Only)\nCheck Images | $20 (Business Only)";
    expect(ownPriceAudience(text, row.fee_name, 10)).toMatchObject({ kind: "qualified", audience: "consumer" });
    expect(ownPriceAudience(text, row.fee_name, 20)).toMatchObject({ kind: "qualified", audience: "business" });
  });

  it("places a proved own scope before a broader schedule URL/title", () => {
    const businessUrl = { ...row, source_url: "https://bank.example/business-fee-schedule.pdf" };
    const text = "BUSINESS FEE SCHEDULE\nCheck Images\n• $10 (Consumer Only) per statement";
    expect(darwinAudience(businessUrl, 10, text)?.feeAudience).toBe("business");
    expect(darwinAudience(businessUrl, 10, text, optIn)?.feeAudience).toBe("consumer");
    const conflict = `${text}\nCheck Images | $10 (Business Only)`;
    expect(darwinAudience(businessUrl, 10, conflict, optIn)).toBeNull();
  });

  it("keeps existing name/product exceptions and paired-price semantics", () => {
    for (const feeName of ["Personal Check Copy", "Corporate Check Copy"]) {
      const text = mixed(`${feeName} | $10 for credit union business only`);
      expect(darwinAudience({ ...row, fee_name: feeName }, 10, text, optIn))
        .toEqual(darwinAudience({ ...row, fee_name: feeName }, 10, text));
    }
    const paired = mixed("Check Images | $10 personal / $20 business");
    expect(darwinAudience(row, 10, paired, optIn)).toEqual(darwinAudience(row, 10, paired));
    expect(darwinAudience(row, 20, paired, optIn)).toEqual(darwinAudience(row, 20, paired));
    const named = { ...row, fee_name: "Business Check Images" };
    const text = mixed("Business Check Images | $10");
    expect(darwinAudience(named, 10, text, optIn)).toEqual(darwinAudience(named, 10, text));
    expect(darwinAudience(named, 10, mixed("Business Check Images | $10 (Business Only)"), optIn))
      .toEqual(darwinAudience(named, 10, text));
    expect(darwinAudience(named, 10, mixed("Business Check Images | $10 (Consumer Only)"), optIn)).toBeNull();
    expect(darwinAudience({ ...row, fee_audience: "business" }, 10, source, optIn)).toBeNull();
  });

  it("leaves live v4 historical relabel decisions and its title-only both transition unchanged", () => {
    const existing = {
      fee_verified_id: 198096,
      fee_raw_id: 943014,
      institution_id: 3381,
      source_document_id: 17019,
      source_url: row.source_url,
      fee_name: row.fee_name,
      amount: 10,
      canonical_fee_key: "check_image",
      fee_audience: "both",
      audience_evidence: "darwin:mixed_schedule_unqualified: unrelated context",
      fee_published_ids: [155214],
    } satisfies AudienceRelabelRow;
    const decision = decideAudience(existing, source);
    expect(decision.feeAudience).toBe("both");
    expect(changesAudience(existing, decision)).toBe(false);
    const prospective = darwinAudience(row, 10, source, optIn)!;
    expect(changesAudience(existing, {
      feeVerifiedId: existing.fee_verified_id,
      feeAudience: prospective.feeAudience,
      source: "fee_exclusive_price_clause",
      evidence: prospective.audienceEvidence,
    })).toBe(false);
  });
});
