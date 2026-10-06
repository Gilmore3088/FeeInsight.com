/** Sample storyline for tests and visual checks only. Every figure here is made up. */
import type { Storyline } from "./types";

const src = { label: "Bank Fee Index, published fee schedules", table: "published_fee_catalog", asOf: "2026-10-01" };
const fil = { label: "FDIC call report", table: "institution_financial_records", asOf: "2026-06-30" };
const f = (text: string, source = src, sampleSize?: number) => ({ text, source, sampleSize });

export function sampleStoryline(): Storyline {
  return {
    kind: "segment",
    governingThought: "At $32, Example Bank charges less than 11 of the 18 largest banks, but it is one of 6 without a daily cap.",
    situation: [f("18 of 152 institutions with $10 billion or more in assets publish an overdraft fee; the median is $34.", src, 18)],
    complication: [f("4 of them have dropped overdraft to $0 since 2022, and 12 now cap it at 3 items a day.", src, 18)],
    keyFigures: [
      { value: "$32", label: "Your overdraft fee", source: src },
      { value: "$34", label: "Median, $10B and up", source: src, n: 18 },
      { value: "4 of 18", label: "Charge nothing", source: src, n: 18 },
      { value: "12 of 18", label: "Publish a daily cap", source: src, n: 18 },
    ],
    exhibits: [
      {
        id: "seg",
        actionTitle: "Most of the largest banks still charge $30 or more; four charge nothing",
        exhibit: {
          kind: "segment_table",
          title: "t",
          own: 32,
          ownLabel: "Example Bank",
          sources: [src],
          members: ["Alpha Bank", "Beta Bank", "Gamma Bank", "Delta Bank", "Epsilon Bank"].map((n, i) => ({
            institutionId: i,
            institutionName: n,
            amount: [34, 10, 35, 0, 15][i],
            stateCode: "NY",
            documentUrls: [],
            sourceDocumentIds: [],
            publishedAt: null,
            charterType: "bank",
            totalAssets: 3_000_000_000 / (i + 1),
            dailyCap: i % 2 ? 3 : null,
          })),
        },
        takeaway: f("Your price sits in the middle; your lack of a cap does not.", src, 18),
      },
      {
        id: "time",
        actionTitle: "Four of the largest banks moved in the last two years, all of them down",
        exhibit: {
          kind: "change_timeline",
          title: "t",
          sources: [src],
          events: [
            { date: "2025-03-01", institutionName: "Beta Bank", from: 35, to: 10, url: null },
            { date: "2026-01-15", institutionName: "Delta Bank", from: 34, to: 0, url: null },
          ],
        },
      },
      {
        id: "struct",
        actionTitle: "Caps, not prices, are where you differ most",
        exhibit: {
          kind: "structure_matrix",
          title: "t",
          sources: [src],
          columns: ["Overdraft fee", "NSF fee", "Daily cap", "Transfer fee", "Continuous OD"],
          rows: [
            { name: "Example Bank", cells: ["$32", "$32", null, "$10", "$5 a day"], own: true },
            { name: "Alpha Bank", cells: ["$34", "$0", "3 a day", "$0", null] },
            { name: "Beta Bank", cells: ["$10", "$0", "3 a day", "$0", null] },
          ],
        },
      },
      {
        id: "money",
        actionTitle: "A move to the median changes fee income by less than 1% of service charges",
        exhibit: {
          kind: "money_at_stake",
          title: "t",
          sources: [fil],
          note: "No overdraft line on file, so this is total service-charge income.",
          rows: [
            { label: "Match the median, $34", low: 40_000, high: 60_000, evidenceLevel: "working_estimate" },
            { label: "Cap at 3 a day", low: -120_000, high: -60_000, evidenceLevel: "working_estimate" },
            { label: "No fee", low: -900_000, high: -700_000, evidenceLevel: "working_estimate" },
          ],
        },
      },
      {
        id: "arch",
        actionTitle: "You price like the middle group but structure like the premium group",
        exhibit: {
          kind: "archetype_map",
          title: "t",
          sources: [src],
          ownKey: "mid",
          archetypes: [
            { key: "zero_od", label: "No overdraft fee", rule: "$0", count: 4, names: ["Delta Bank", "Theta Bank"] },
            { key: "low_capped", label: "Low and capped", rule: "Under $20, daily cap", count: 3, names: ["Beta Bank"] },
            { key: "mid", label: "Middle", rule: "$20 to $34", count: 6, names: ["Kappa Bank"] },
            { key: "premium", label: "Premium", rule: "$35 and up", count: 5, names: ["Gamma Bank", "Alpha Bank"] },
          ],
        },
      },
    ],
    lenses: {
      finance: [f("A daily cap of 3 would lower overdraft income by $60,000 to $120,000 a year on filed figures.", fil)],
      market: [f("12 of the 18 largest banks advertise a daily cap; customers comparing schedules will see yours has none.", src, 18)],
    },
    options: [
      { label: "Keep $32, no cap", consequences: [f("No change to income; you stay one of 6 large-bank peers without a cap.", src, 18)] },
      { label: "Keep $32, cap at 3 a day", consequences: [f("$60,000 to $120,000 less a year; structure matches 12 of 18.", fil)] },
      { label: "Move to $0", consequences: [f("$700,000 to $900,000 less a year; joins 4 of 18.", fil)] },
    ],
    watch: [f("A cap rule from the CFPB or OCC would reset the comparison.", src)],
  };
}
