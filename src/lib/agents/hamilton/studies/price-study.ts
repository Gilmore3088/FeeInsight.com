import { STUDY_FEES, assetBand, type Charter, type InstitutionPrice, type StudyFee } from "./common";
import { mean, median, midRankPercentile, ols, quartileOf, round, spearman } from "./stats";
import type { Placement } from "./store";

/**
 * A price study: does a fee's published price move with one market driver (local
 * income, market concentration, fee income)? Pure, so the numbers are testable.
 *
 * Per fee it reports the rank correlation, the average price in each fifth of the
 * driver, and a regression of price on the driver with controls for size (log assets)
 * and charter, with robust 95% intervals. Prices are a snapshot of live schedules, so
 * every result is cross-sectional: it describes how prices differ across institutions
 * today, not how a price moves when the driver changes.
 */

export interface Driver {
  key: string;
  /** Plain words for the driver, e.g. "local median household income". */
  label: string;
  /** The regression reports the price change per this many driver units. */
  perUnits: number;
  /** Plain words for perUnits, e.g. "$10,000 of local income". */
  perLabel: string;
  values: Map<number, number>;
}

export interface FeeResult {
  fee: StudyFee;
  n: number;
  nBank: number;
  nCreditUnion: number;
  spearman: number | null;
  spearmanBank: number | null;
  spearmanCreditUnion: number | null;
  /** Average and median price in each fifth of the driver, lowest fifth first. */
  fifths: Array<{ fifth: number; driverLow: number | null; driverHigh: number | null; meanPrice: number | null; medianPrice: number | null; n: number }>;
  /** Price change per `perUnits` of the driver, holding size and charter fixed. */
  effect: { estimate: number; ciLow: number; ciHigh: number; p: number; r2: number } | null;
  significant: boolean;
}

export interface PriceStudyResult {
  driver: { key: string; label: string; perLabel: string };
  institutions: number;
  fees: FeeResult[];
  headline: string;
  placements: Placement[];
}

const MIN_ROWS = 30;

function fifthOf(rank: number, n: number): number {
  return Math.min(5, Math.floor((rank * 5) / n) + 1);
}

function money(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

export function feeLabel(fee: StudyFee): string {
  return fee.replace(/_/g, " ").replace("nsf", "NSF").replace("atm", "ATM");
}

function analyseFee(fee: StudyFee, rows: Array<InstitutionPrice & { x: number }>, driver: Driver): FeeResult {
  const sorted = [...rows].sort((a, b) => a.x - b.x);
  const fifths = [1, 2, 3, 4, 5].map((fifth) => {
    const inFifth = sorted.filter((_, i) => fifthOf(i, sorted.length) === fifth);
    return {
      fifth,
      driverLow: inFifth.length ? round(inFifth[0].x, 4) : null,
      driverHigh: inFifth.length ? round(inFifth[inFifth.length - 1].x, 4) : null,
      meanPrice: round(mean(inFifth.map((r) => r.amount))),
      medianPrice: round(median(inFifth.map((r) => r.amount))),
      n: inFifth.length,
    };
  });
  const bank = rows.filter((r) => r.charter === "bank");
  const cu = rows.filter((r) => r.charter === "credit_union");
  const sizeKnown = rows.filter((r) => (r.assetsThousands ?? 0) > 0);
  const columns: Record<string, number[]> = {
    driver: sizeKnown.map((r) => r.x / driver.perUnits),
    log_assets: sizeKnown.map((r) => Math.log10(Number(r.assetsThousands))),
  };
  const charters = new Set(sizeKnown.map((r) => r.charter));
  if (charters.size > 1) columns.credit_union = sizeKnown.map((r) => (r.charter === "credit_union" ? 1 : 0));
  const model = sizeKnown.length >= MIN_ROWS ? ols(sizeKnown.map((r) => r.amount), columns) : null;
  const coef = model?.coefficients.find((c) => c.name === "driver");
  return {
    fee,
    n: rows.length,
    nBank: bank.length,
    nCreditUnion: cu.length,
    spearman: round(spearman(rows.map((r) => r.x), rows.map((r) => r.amount))),
    spearmanBank: bank.length >= MIN_ROWS ? round(spearman(bank.map((r) => r.x), bank.map((r) => r.amount))) : null,
    spearmanCreditUnion: cu.length >= MIN_ROWS ? round(spearman(cu.map((r) => r.x), cu.map((r) => r.amount))) : null,
    fifths,
    effect: coef && model
      ? { estimate: round(coef.estimate, 3)!, ciLow: round(coef.ciLow, 3)!, ciHigh: round(coef.ciHigh, 3)!, p: round(coef.p, 4)!, r2: round(model.r2, 3)! }
      : null,
    significant: Boolean(coef && coef.p < 0.05),
  };
}

function headlineFor(driver: Driver, fees: FeeResult[]): string {
  const moving = fees.filter((f) => f.significant && f.effect).sort((a, b) => Math.abs(b.effect!.estimate) - Math.abs(a.effect!.estimate));
  const flat = fees.filter((f) => !f.significant && f.n >= MIN_ROWS).map((f) => feeLabel(f.fee));
  if (moving.length === 0) return `No study fee's price moves with ${driver.label} once size and charter are held fixed.`;
  const lead = moving[0];
  const dir = lead.effect!.estimate > 0 ? "higher" : "lower";
  const tail = flat.length ? ` ${flat.slice(0, 3).join(", ")} show no clear link.` : "";
  return `The ${feeLabel(lead.fee)} fee runs ${money(lead.effect!.estimate)} ${dir} per ${driver.perLabel}, holding size and charter fixed.${tail}`;
}

export function runPriceStudy(prices: InstitutionPrice[], driver: Driver): PriceStudyResult {
  const joined = prices.filter((p) => driver.values.has(p.institutionId)).map((p) => ({ ...p, x: driver.values.get(p.institutionId)! }));
  const fees = STUDY_FEES.map((fee) => analyseFee(fee, joined.filter((r) => r.fee === fee), driver)).filter((f) => f.n > 0);

  // Placement: where the institution sits on the driver, and its price against the
  // institutions in the same fifth of the driver, per fee.
  const institutions = new Map<number, { charter: Charter; assets: number | null; x: number; prices: Map<StudyFee, number> }>();
  for (const r of joined) {
    const entry = institutions.get(r.institutionId) ?? { charter: r.charter, assets: r.assetsThousands, x: r.x, prices: new Map() };
    entry.prices.set(r.fee, r.amount);
    institutions.set(r.institutionId, entry);
  }
  const allX = [...institutions.values()].map((v) => v.x);
  const fifthPeers = new Map<string, number[]>();
  const fifthFor = (x: number) => {
    const pct = midRankPercentile(x, allX) ?? 0;
    return Math.min(5, Math.floor(pct / 20) + 1);
  };
  for (const v of institutions.values()) {
    const fifth = fifthFor(v.x);
    for (const [fee, amount] of v.prices) {
      const key = `${fee}|${fifth}`;
      const list = fifthPeers.get(key) ?? [];
      list.push(amount);
      fifthPeers.set(key, list);
    }
  }
  const placements: Placement[] = [];
  for (const [institutionId, v] of institutions) {
    const percentile = midRankPercentile(v.x, allX);
    const fifth = fifthFor(v.x);
    const byFee: Record<string, unknown> = {};
    for (const [fee, amount] of v.prices) {
      const peers = fifthPeers.get(`${fee}|${fifth}`) ?? [];
      byFee[fee] = { price: amount, fifth_median: round(median(peers)), fifth_n: peers.length, price_percentile_in_fifth: midRankPercentile(amount, peers) };
    }
    placements.push({
      institutionId,
      metric: driver.key,
      value: round(v.x, 4),
      peerGroup: "all institutions in this study",
      peerN: allX.length,
      peerMedian: round(median(allX), 4),
      percentile,
      quartile: quartileOf(percentile),
      detail: { fifth, size_band: assetBand(v.assets), charter: v.charter, fees: byFee },
    });
  }

  return {
    driver: { key: driver.key, label: driver.label, perLabel: driver.perLabel },
    institutions: institutions.size,
    fees,
    headline: headlineFor(driver, fees),
    placements,
  };
}
