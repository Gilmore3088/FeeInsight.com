// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownFeeUnit, withOwnFeeUnit } from "./own-fee-unit";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { candidateWriteFacts } from "@/lib/agents/knox/candidate-facts";
import { readerFeeConditions } from "@/lib/fee-conditions";
import { settledFrequency } from "@/lib/fee-frequency";
import { groundPaidRow } from "@/lib/agents/knox/paid-extract";

const cases = [
  ["Faxed Transmissions | $1/page", "Faxed Transmissions", 1, "document_reproduction", "per_page"],
  ["Account Reconciliation\n• $35.00 per hour", "Account Reconciliation", 35, "account_research", "hourly"],
  ["Photocopies\n• $1.00 per page", "Photocopies", 1, "document_reproduction", "per_page"],
  ["Photocopies | $5 per document", "Photocopies", 5, "document_reproduction", "per_document"],
  ["Copy of canceled check image\n• $5 per image", "Copy of canceled check image", 5, "check_image", "per_image"],
  ["Check Images\n• $10 (Consumer Only) per statement", "Check Images", 10, "check_image", "per_statement"],
  ["Research Fee | $50 per half hour", "Research Fee", 50, "account_research", "per_half_hour"],
  ["Research Fee (per quarter hour) | $10 Each", "Research Fee", 10, "account_research", "per_quarter_hour"],
  ["Research Fee | $2 per minute", "Research Fee", 2, "account_research", "per_minute"],
  ["| Research fee (1/2-hour minimum charge) | $50.00 per 1/2 hour |", "Research fee (1/2-hour minimum charge)", 50, "account_research", "per_half_hour"],
] as const;

describe("#2248 literal own charging units", () => {
  it.each(cases)("preserves the literal price and unit from %s", (source, name, amount, category, frequency) => {
    const own = ownFeeUnit(source, name, amount, category);
    expect(own?.frequency).toBe(frequency);
    expect(own?.sourceLine).toContain(`$${amount}`);
    expect(settledFrequency(own!.sourceLine, amount, frequency, category, { hourly: false })).toBe(frequency);
  });

  it("replays the exact hash-bound Milaca source through the actual free producer and customer facts", () => {
    const source = JSON.parse(readFileSync(new URL("../agents/knox/__fixtures__/milaca-own-page-unit.json", import.meta.url), "utf8"));
    expect(createHash("sha256").update(source.normalizedText).digest("hex")).toBe(source.textSHA256);
    const row = runFreeSpecialists(source.normalizedText).candidates.find(candidate => candidate.feeName === "Faxed Transmissions" && candidate.amount === 1)!;
    expect(row).toMatchObject({ frequency: "per_page", amount: 1 });
    expect(readerFeeConditions(candidateWriteFacts(row).sourceConditions)).toContain("$1/page");
  });

  it("keeps Morton's exact hash-bound outer-pipe table price and half-hour minimum through the free team", () => {
    const source = JSON.parse(readFileSync(new URL("../agents/knox/__fixtures__/morton-own-half-hour-unit.json", import.meta.url), "utf8"));
    expect(createHash("sha256").update(source.normalizedText).digest("hex")).toBe(source.textSHA256);
    const row = runFreeSpecialists(source.normalizedText).candidates.find(candidate =>
      candidate.feeName === "Research fee (1/2-hour minimum charge)" && candidate.amount === 50);
    expect(row).toMatchObject({ amount: 50, frequency: "per_half_hour" });
    expect(readerFeeConditions(candidateWriteFacts(row!).sourceConditions)).toContain("$50.00 per 1/2 hour");
    expect(candidateWriteFacts(row!).sourceConditions).toContain("1/2-hour minimum charge");
  });

  it.each([
    ["Research Fee (per hour) | $25 Each", 25, "hourly"],
    ["Research Fee (per half hour) | $15", 15, "per_half_hour"],
    ["Research Fee (hourly) | $25", 25, "hourly"],
  ])("keeps a literal parenthetical unit in %s", (source, amount, frequency) => {
    const own = ownFeeUnit(source, "Research Fee", Number(amount), "account_research");
    expect(own?.frequency).toBe(frequency);
    expect(settledFrequency(own!.sourceLine, Number(amount), String(frequency), "account_research", { hourly: false })).toBe(frequency);
  });

  it("does not select a unit from a neighbor, incomplete repeated name or incompatible own occurrence", () => {
    for (const source of [
      "Research Fee | $25 each | Photocopies $25/page",
      "Research Fee | $25 each\nPhotocopies | $25/page",
      "Research Fee | $25 per hour\nResearch Fee | $25 each",
      "Research Fee | $25 each\nResearch Fee | $25 per hour",
      "Research Fee | $25 per hour\nResearch Fee | $25 per page",
      "Research Fee\n$25 per hour\nResearch Fee | $25 per page",
      "Research Fee $25 per hour or per image",
      "Research Fee (hourly) | $25 per image",
      "Research Fee (per hour) | $25 per half hour",
      "Research Fee | $25 (1/2 hour minimum)",
      "Research Fee | $25 within 24 hours",
      "| Research Fee | $25 each | Photocopies | $25 per page |",
      "| Research Fee | $25 per hour |\n| Research Fee | $25 per page |",
    ]) expect(ownFeeUnit(source, "Research Fee", 25, "account_research"), source).toBeNull();
  });

  it("keeps a minimum separate from the basis and never turns a statement into a month", () => {
    expect(ownFeeUnit("Research Fee | $25 per hour (1/2 hour minimum)", "Research Fee", 25, "account_research")?.frequency).toBe("hourly");
    const paper = ownFeeUnit("Paper Statement | $5 per statement", "Paper Statement", 5, "paper_statement");
    expect(paper?.frequency).toBe("per_statement");
    expect(settledFrequency(paper!.sourceLine, 5, "per_statement", "paper_statement", { hourly: false })).toBe("per_statement");
  });

  it("does not turn unit metadata into category or price authority", () => {
    for (const category of ["nsf", "overdraft", "monthly_maintenance", "dormant_account", "continuous_od"]) {
      expect(ownFeeUnit("Research Fee | $25 per minute", "Research Fee", 25, category), category).toBeNull();
      expect(ownFeeUnit("Research Fee | $25 per hour", "Research Fee", 25, category), category).toBeNull();
    }
    expect(ownFeeUnit("Research Fee | $25 per hour", "Research Fee", 20, "account_research")).toBeNull();
  });

  it("derives paid accepted units from the actual source rather than the model's claimed frequency", () => {
    const source = "Research Fee (per quarter hour) | $10.00";
    const paid = groundPaidRow({ fee_name: "Research Fee", canonical_key: "account_research", amount: 10,
      source_line: source, frequency: "monthly", conditions: "unsupported model condition" }, source);
    expect(paid).toMatchObject({ frequency: "per_quarter_hour", ownUnit: { frequency: "per_quarter_hour", sourceLine: source } });
  });

  it("keeps a literal zero-price unit without inventing or rescaling a numeric price", () => {
    const source = "Photocopies | $0 per page";
    const held = runFreeSpecialists(source).held.find(row => row.feeName === "Photocopies" && row.amount === 0);
    expect(held).toMatchObject({ shape: "zero", amount: 0, frequency: "per_page", ownUnit: { sourceLine: source } });
  });

  it("retains existing complete conditions and linked scope when adding an own-unit fact", () => {
    const candidate = {
      feeName: "Research Fee", amount: 25, canonicalHint: "account_research", frequency: null,
      confidence: .9, excerpt: "Research Fee $25 per hour; only for requests after account closure", waivable: false,
      ownedBullet: true as const, linkedConditions: "The first request is free.",
    };
    const read = withOwnFeeUnit(candidate, "Research Fee | $25 per hour");
    expect(candidateWriteFacts(read).sourceConditions).toContain("only for requests after account closure");
    expect(candidateWriteFacts(read).sourceConditions).toContain("The first request is free.");
  });
});
