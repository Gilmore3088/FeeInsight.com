import {
  compareAccountLineups,
  summarizeLineup,
  type LineupAccount,
  type LineupSummary,
} from "@/lib/data-store/account-lineup";
import { BUSINESS_PRICE, maintenanceLineIsNotChecking } from "@/lib/data-store/custom-report-market";
import { MIN_LOCAL_PEERS_PER_LINE } from "./analysis";
import { ADD_ON_FEATURE, ADD_ON_IN_QUOTE } from "./evidence";

/**
 * The checking account lineup for one institution against its market: each consumer checking
 * account it publishes with a monthly fee, beside the same figures for its local competitors.
 * Built on the account-lineup read model (src/lib/data-store/account-lineup.ts). Pure: the
 * caller loads the accounts. A figure the schedules do not state stays null and is shown as
 * "not stated", never as a zero or an estimate.
 */

export const NOT_STATED = "not stated";

/** An account that names itself as checking (or a credit union share draft). */
const CHECKING_NAME = /\b(checking|share drafts?)\b/i;

/**
 * A consumer checking account: not a business price, not an optional add-on's charge (ATM
 * refunds, identity protection), and not a savings, money market, certificate or IRA fee. An account that names itself as checking stays in even when its
 * schedule line mentions savings (a waiver with a linked savings account); an unnamed monthly
 * fee is judged by its schedule line, the same test the report's monthly maintenance line uses.
 */
export function isConsumerCheckingAccount(account: Pick<LineupAccount, "productName" | "feeName" | "sourceLine">): boolean {
  const names = [account.productName ?? "", account.feeName].join(" ");
  if (BUSINESS_PRICE.test(names)) return false;
  // An optional add-on's monthly charge is not an account, by the fee comparison's own rule (evidence.ts).
  if (ADD_ON_FEATURE.test(names) || ADD_ON_IN_QUOTE.test(account.sourceLine ?? "")) return false;
  if (CHECKING_NAME.test(names)) return true;
  return ![names, account.sourceLine ?? ""].some((text) => maintenanceLineIsNotChecking("monthly_maintenance", text));
}

export interface LineupPeer {
  institutionId: number;
  name: string;
}

export interface CheckingLineupView {
  subject: LineupSummary & { accountsList: LineupAccount[] };
  /** Every competitor's checking accounts pooled. */
  peers: LineupSummary;
  /** Competitors in the market, the subject left out. */
  peersInMarket: number;
  /** Competitors with at least one checking account and monthly fee on file. */
  peersWithLineup: number;
  /** Of those, how many state a balance that avoids the fee on any account. */
  peersWithBalance: number;
  /** Of those, how many state another way to avoid the fee on any account. */
  peersWithWaiver: number;
  /** Of those, how many list an account with no monthly fee. */
  peersWithFreeAccount: number;
  /** Competitors' fee-charging checking accounts: the base of the way-to-avoid share. */
  peerChargingAccounts: number;
  /** One row per competitor with a lineup, in the order the caller gave (largest first). */
  peerRows: (LineupPeer & { summary: LineupSummary })[];
  /** Monthly fee rows left out as savings, money market, certificate, IRA, business or an add-on. */
  leftOut: number;
  /** True when any figure shown was read from the schedule line rather than stored. */
  anyDerived: boolean;
}

/** The subject's checking lineup against the given market peers. */
export function buildCheckingLineup(subjectId: number, peers: LineupPeer[], accounts: LineupAccount[]): CheckingLineupView {
  const peerList = peers.filter((peer, index) => peer.institutionId !== subjectId && peers.findIndex((p) => p.institutionId === peer.institutionId) === index);
  const inMarket = new Set([subjectId, ...peerList.map((peer) => peer.institutionId)]);
  const marketAccounts = accounts.filter((account) => inMarket.has(account.institutionId));
  const checking = marketAccounts.filter(isConsumerCheckingAccount);
  const comparison = compareAccountLineups(subjectId, checking);

  const byPeer = new Map<number, LineupAccount[]>();
  for (const account of checking) {
    if (account.institutionId === subjectId) continue;
    byPeer.set(account.institutionId, [...(byPeer.get(account.institutionId) ?? []), account]);
  }
  const peerRows = peerList
    .filter((peer) => byPeer.has(peer.institutionId))
    .map((peer) => ({ ...peer, summary: summarizeLineup(byPeer.get(peer.institutionId)!) }));
  const peerAccounts = [...byPeer.values()];

  return {
    subject: { ...comparison.subject, accountsList: [...comparison.subject.accountsList].sort((a, b) => a.monthlyFee - b.monthlyFee) },
    peers: comparison.peers,
    peersInMarket: peerList.length,
    peersWithLineup: byPeer.size,
    peersWithBalance: peerAccounts.filter((list) => list.some((a) => a.minBalanceToAvoid !== null)).length,
    peersWithWaiver: peerAccounts.filter((list) => list.some((a) => a.waiverText !== null)).length,
    peersWithFreeAccount: peerAccounts.filter((list) => list.some((a) => a.monthlyFee === 0)).length,
    peerChargingAccounts: peerAccounts.flat().filter((a) => a.monthlyFee > 0).length,
    peerRows,
    leftOut: marketAccounts.length - checking.length,
    anyDerived: checking.some(
      (a) => a.productNameSource === "derived" || a.minBalanceSource === "derived" || a.waiverSource === "derived",
    ),
  };
}

/** "$12", "$4.50", or "not stated". */
export function lineupMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_STATED;
  return Number.isInteger(value) ? `$${value.toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
}

/** "40%", or "not stated" when there was nothing to divide by. */
export function lineupShare(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_STATED;
  return `${Math.round(value * 100)}%`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** One sentence on how much of the market the comparison rests on. */
export function lineupCoverageLine(view: CheckingLineupView): string {
  const { peersWithLineup, peersInMarket, peers } = view;
  if (peersInMarket === 0) return "No local competitors are on file for this market.";
  const base = `Checking lineup on file for ${peersWithLineup.toLocaleString("en-US")} of ${plural(peersInMarket, "local competitor", "local competitors")}`;
  if (peersWithLineup === 0) return `${base}, so there is no market figure to set beside yours yet.`;
  const states = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "states" : "state"}`;
  return `${base} (${plural(peers.accounts, "account", "accounts")}). Of those competitors, ${states(view.peersWithBalance)} a balance that avoids the fee and ${states(view.peersWithWaiver)} another way to avoid it.`;
}

/**
 * Fewest competitors that must state a figure before the market column shows a median of it:
 * the same floor the report's fee lines use, so a figure from two schedules never reads as a
 * market benchmark.
 */
export const MIN_LINEUP_PEERS_FOR_MEDIAN = MIN_LOCAL_PEERS_PER_LINE;

/** True for a cell that carries no figure: unstated, or withheld below the floor. */
export function isNoFigure(text: string): boolean {
  return text === NOT_STATED || text.startsWith(TOO_FEW);
}

/** "Yes", or "None found": a missing no-fee account may only be missing from the schedules reviewed. */
export function noFeeAccountText(summary: Pick<LineupSummary, "accounts" | "shareWithFreeAccount">): string {
  if (summary.accounts === 0) return NOT_STATED;
  return summary.shareWithFreeAccount !== null && summary.shareWithFreeAccount > 0 ? "Yes" : "None found";
}

export const TOO_FEW = "Too few to compare";

const reporting = (n: number) => `${plural(n, "competitor", "competitors")} reporting`;

/** A competitor median beside how many competitors it rests on; withheld below the floor. */
function marketMedian(value: number | null, peersStating: number): string {
  if (peersStating === 0 || value === null) return NOT_STATED;
  if (peersStating < MIN_LINEUP_PEERS_FOR_MEDIAN) return `${TOO_FEW} · ${reporting(peersStating)}`;
  return `${lineupMoney(value)} · ${reporting(peersStating)}`;
}

/** The measures shown side by side, subject then market. Values are display strings, each market figure with its count. */
export function lineupMeasures(view: CheckingLineupView): { label: string; yours: string; market: string }[] {
  const { subject, peers, peersWithLineup } = view;
  const noPeers = peersWithLineup === 0;
  const market = (value: string) => (noPeers ? NOT_STATED : value);
  return [
    {
      label: "Checking accounts with a monthly fee line",
      yours: subject.accounts.toLocaleString("en-US"),
      market: market(`${peers.accounts.toLocaleString("en-US")} across ${plural(peersWithLineup, "competitor", "competitors")}`),
    },
    { label: "Lowest monthly fee", yours: lineupMoney(subject.lowestMonthlyFee), market: market(`${lineupMoney(peers.lowestMonthlyFee)} · ${reporting(peersWithLineup)}`) },
    {
      // Every account pooled, not one value per institution: the fee comparison's local median of
      // monthly maintenance is the median of each competitor's own median checking price, so the
      // two figures differ by method and population, and each says which beside it.
      label: "Median monthly fee, every account pooled",
      yours: lineupMoney(subject.medianMonthlyFee),
      market: market(
        peersWithLineup < MIN_LINEUP_PEERS_FOR_MEDIAN
          ? marketMedian(peers.medianMonthlyFee, peersWithLineup)
          : `${lineupMoney(peers.medianMonthlyFee)} · median of ${plural(peers.accounts, "account", "accounts")} pooled across ${plural(peersWithLineup, "competitor", "competitors")}`,
      ),
    },
    {
      label: "No-fee checking account found in the schedules reviewed",
      yours: noFeeAccountText(subject),
      market: market(`${view.peersWithFreeAccount.toLocaleString("en-US")} of ${plural(peersWithLineup, "competitor", "competitors")}`),
    },
    { label: "Median balance to avoid the fee", yours: lineupMoney(subject.medianMinBalanceToAvoid), market: market(marketMedian(peers.medianMinBalanceToAvoid, view.peersWithBalance)) },
    {
      label: "Fee-charging accounts that say how to avoid the fee",
      yours: lineupShare(subject.shareWithWayToAvoid),
      market: market(
        view.peerChargingAccounts === 0
          ? NOT_STATED
          : `${lineupShare(peers.shareWithWayToAvoid)} of ${plural(view.peerChargingAccounts, "account", "accounts")}`,
      ),
    },
  ];
}
