import { describe, expect, it } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import { STATE_NAMES } from "@/lib/us-states";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { bandBreakdown, histogram, inBucket, institutionsFor, stateCells, statsFor, type Charter } from "./index-view";

/**
 * The explorer's numbers must agree with each other for every fee, place and charter (James's Oct 18
 * release sign-off, gate 2): the chart, the KPIs, the list, the charter split and the state map all
 * count one population, the one the median is taken over. Rows here are random but seeded, and cover
 * $0 prices, institutions listing several prices, sibling charters on one schedule, and rows with
 * no state or a territory.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const STATES = ["FL", "TX", "CA", "MS", "VT", "DC", "PR", null] as const;
const PRICES = [0, 0, 2.5, 5, 5, 10, 12, 15, 25, 25, 27.5, 30, 30, 32, 35, 36, 50, 125];

function makeRows(seed: number, institutions: number): IndexRow[] {
  const r = rng(seed);
  const rows: IndexRow[] = [];
  let id = 1;
  for (let inst = 1; inst <= institutions; inst++) {
    const state = STATES[Math.floor(r() * STATES.length)];
    const charter = r() < 0.4 ? "bank" : "credit_union";
    // About one in ten shares a schedule with the institution before it under one holding company.
    const sibling = inst > 1 && r() < 0.1;
    const anchor = sibling ? inst - 1 : inst;
    const schedule = `u:schedule/${anchor}`;
    const prices = 1 + Math.floor(r() * 3);
    for (let p = 0; p < prices; p++) {
      rows.push({
        id: id++,
        institution_id: inst,
        institution_name: `Institution ${inst}`,
        amount: PRICES[Math.floor(r() * PRICES.length)],
        charter_type: charter,
        state_code: state,
        schedule_keys: [schedule],
        schedule_group: `hc${anchor}`,
      });
    }
  }
  return rows;
}

/** An independent median: sort the counted values and take the middle, averaging the two middles. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = (v.length - 1) / 2;
  return Math.round(((v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2) * 100) / 100;
}

const CHARTERS: Charter[] = ["all", "bank", "credit_union"];
const PLACES = [null, "FL", "TX", "MS", "VT", "DC"];

describe("Bank Fee Index explorer invariants", () => {
  for (const fee of ["overdraft", "dormant_account", "wire_domestic_outgoing"]) {
    for (const seed of [1, 7, 42]) {
      const rows = makeRows(seed, 160);
      it(`${fee}, seed ${seed}: every view counts the median's population`, () => {
        for (const charter of CHARTERS) {
          for (const state of PLACES) {
            const listed = institutionsFor(rows, fee, state, charter);
            const stats = statsFor(rows, fee, state, charter);
            const bars = histogram(listed);
            const label = `${fee} ${state ?? "US"} ${charter}`;

            // The chart, the KPI and the list are one population.
            expect(bars.reduce((n, b) => n + b.total, 0), label).toBe(listed.length);
            expect(stats.institution_count, label).toBe(listed.length);
            // Every institution sits in exactly one bar, and a $0 price only in the $0 bar.
            for (const i of listed) expect(bars.filter((b) => inBucket(b, i.value)).length, label).toBe(1);
            const zero = bars.find((b) => b.min === 0 && b.max === 0);
            expect(zero?.total ?? 0, label).toBe(listed.filter((i) => i.value === 0).length);
            // Banks and credit unions add up to the whole.
            const split = bandBreakdown(listed);
            expect(split.banks + split.creditUnions, label).toBe(listed.length);
            // The median matches an independent calculation over the same values, and is withheld
            // below the floor rather than shown from too few institutions.
            const expected = listed.length >= MIN_INSTITUTIONS_FOR_MEDIAN ? median(listed.map((i) => i.value)) : null;
            expect(stats.median_amount, label).toBe(expected);
          }
          if (charter === "all") expect(institutionsFor(rows, fee, null, "all").some((i) => i.shared > 0)).toBe(true);
          // Each state on the map counts what the explorer counts with that state picked, and the
          // states cover every institution headquartered in the 50 states and DC. Sibling charters
          // in two states count once nationally but once in each state, so the states can only
          // add up to more than the nation, never less.
          const national = institutionsFor(rows, fee, null, charter);
          const inStates = national.filter((i) => i.state && i.state !== "PR" && STATE_NAMES[i.state]).length;
          const cells = stateCells(rows, fee, charter);
          expect(cells.length).toBe(51);
          for (const c of cells) expect(c.institutions, `${fee} ${c.code} ${charter}`).toBe(institutionsFor(rows, fee, c.code, charter).length);
          expect(cells.reduce((n, c) => n + c.institutions, 0), `${fee} ${charter} states`).toBeGreaterThanOrEqual(inStates);
        }
      });
    }
  }
});
