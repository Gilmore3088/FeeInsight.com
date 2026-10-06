/**
 * The wider context around one fee and one bank: the same fee in every market layer the
 * bank belongs to, the rules that govern changing it, and recent regulator releases that
 * mention it. Pure and client-safe; the loaders in ./research supply the rows.
 */

import { getDisplayName } from "@/lib/fee-taxonomy";
import {
  ADVERSE_CHANGE_NOTICE_DAYS,
  EFT_FEE_NOTICE_DAYS,
  REG_DD_BANK,
  REG_DD_CU,
  REG_E_FEE_NOTICE,
  REG_E_OPT_IN,
  isEftFee,
} from "./implementation";
import { priceBands } from "./bands";
import { MIN_PEERS_FOR_POSITION, pricePosition } from "./scenario";
import type { Fact, MarketLayer, MarketLayerScope, Observation, SourceRef } from "./types";

const FEE_SOURCE: SourceRef = {
  label: "Fees on each institution's own published schedule (verified, live)",
  table: "published_fee_catalog",
};

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100;
}

/** One layer's spread and the bank's place in it. Percentiles stay null when the layer is thin. */
export function marketLayer(
  scope: MarketLayerScope,
  label: string,
  amounts: number[],
  current: number | null,
  publishedAt: (string | null)[] = [],
): MarketLayer {
  const sorted = [...amounts].sort((a, b) => a - b);
  const enough = sorted.length >= MIN_PEERS_FOR_POSITION;
  const asOf = publishedAt.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort().pop() ?? null;
  return {
    scope,
    label,
    n: sorted.length,
    p25: enough ? quantile(sorted, 0.25) : null,
    median: enough ? quantile(sorted, 0.5) : null,
    p75: enough ? quantile(sorted, 0.75) : null,
    position: current === null ? null : pricePosition(current, sorted),
    amounts: sorted,
    bands: priceBands(sorted, current),
    asOf,
    source: { ...FEE_SOURCE, asOf },
  };
}

const REG_DD_OVERDRAFT_TOTALS: SourceRef = {
  label: "Reg DD, 12 CFR 1030.11(a)",
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1030/11/",
};

const OVERDRAFT_CATEGORIES = new Set(["overdraft", "od_daily_cap", "continuous_od", "nsf"]);

/** The federal rules that apply when this fee changes. Stated, not interpreted. */
export function feeRules(feeCategory: string, charterType: string): Fact[] {
  const name = getDisplayName(feeCategory);
  const creditUnion = charterType === "credit_union";
  const facts: Fact[] = [
    {
      text: `An increase in the ${name} needs at least ${ADVERSE_CHANGE_NOTICE_DAYS} days' advance notice to affected consumer account holders.`,
      source: creditUnion ? REG_DD_CU : REG_DD_BANK,
    },
  ];
  if (isEftFee(feeCategory)) {
    facts.push({
      text: `As an electronic fund transfer fee, an increase also needs ${EFT_FEE_NOTICE_DAYS} days' written notice under Reg E.`,
      source: REG_E_FEE_NOTICE,
    });
  }
  if (OVERDRAFT_CATEGORIES.has(feeCategory)) {
    if (feeCategory !== "nsf") {
      facts.push({
        text: "The overdraft opt-in notice states the fee for ATM and one-time debit card overdrafts, so a changed amount means an updated notice.",
        source: REG_E_OPT_IN,
      });
    }
    facts.push({
      text: "Periodic statements show total overdraft and returned item fees for the period and the year to date.",
      source: creditUnion
        ? { label: "NCUA Truth in Savings, 12 CFR 707.11(a)", url: "https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707/section-707.11" }
        : REG_DD_OVERDRAFT_TOTALS,
    });
  }
  return facts;
}

export interface RegArticleRow {
  source: string;
  title: string;
  link: string;
  topic: string;
  published_at: string | null;
}

/** Words that tie a regulator release to a fee category. */
const FEE_TERMS: Record<string, RegExp> = {
  overdraft: /\boverdraft|\bnsf\b|non-?sufficient|insufficient funds|returned item/i,
  nsf: /\bnsf\b|non-?sufficient|insufficient funds|returned item|overdraft/i,
  od_daily_cap: /\boverdraft/i,
  continuous_od: /\boverdraft/i,
};
const ANY_FEE = /\bfees?\b|junk fee|overdraft|\bnsf\b|non-?sufficient|reg(ulation)? ?e\b|reg(ulation)? ?dd\b|truth in savings|electronic fund transfer/i;

/** Releases whose title names this fee (or fees generally), newest first. */
export function feeRegulatoryNews(articles: RegArticleRow[], feeCategory: string, limit = 5): Fact[] {
  const specific = FEE_TERMS[feeCategory];
  const name = getDisplayName(feeCategory).toLowerCase();
  return articles
    .filter((a) => (specific ? specific.test(a.title) : false) || ANY_FEE.test(a.title) || a.title.toLowerCase().includes(name))
    .sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")))
    .slice(0, limit)
    .map((a) => {
      const asOf = a.published_at ? String(a.published_at).slice(0, 10) : null;
      return {
        text: `${a.source}: ${a.title}${asOf ? ` (${asOf})` : ""}`,
        source: { label: `${a.source} release`, table: "reg_articles", url: a.link, asOf },
      };
    });
}

/**
 * A Briefing item for each fee-related regulator release in the window. Only releases
 * whose title mentions fees, overdraft, NSF, Reg E or Reg DD qualify; nothing is inferred.
 */
export function ruleChangeObservations(articles: RegArticleRow[], bankCategories: Set<string>): Observation[] {
  return articles
    .filter((a) => ANY_FEE.test(a.title))
    .map((a) => {
      const asOf = a.published_at ? String(a.published_at).slice(0, 10) : null;
      const feeCategory = [...bankCategories].find((c) => FEE_TERMS[c]?.test(a.title)) ?? null;
      return {
        id: `rule_change:${a.link}`,
        kind: "rule_change" as const,
        feeCategory,
        headline: `${a.source}: ${a.title}`,
        facts: [{
          text: `Published ${asOf ?? "on an unknown date"}.`,
          source: { label: `${a.source} release`, table: "reg_articles", url: a.link, asOf },
        }],
        actions: feeCategory ? ["research_fee" as const, "ask" as const] : ["ask" as const],
        salience: a.topic === "rulemaking_compliance" ? 0.8 : 0.6,
      };
    });
}
