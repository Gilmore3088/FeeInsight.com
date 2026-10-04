#!/usr/bin/env node
// Studio narrator: packs/<id>.json -> narratives/<id>.json, deterministically.
// Every sentence is built from the pack's verified numbers; nothing is hand-typed per institution.
// Claims of rank ("above range", "below range") are made only for lines with >= 8 comparable peers
// (the pack's `percentile` is null otherwise). Usage: node narrate.mjs <id> [<id> ...] | --all
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ids = args.includes("--all")
  ? readdirSync(join(DIR, "packs")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""))
  : args;
if (!ids.length) { console.error("usage: node narrate.mjs <id> [...] | --all"); process.exit(1); }

const CONTACT_EMAIL = "hello@bankfeeindex.com";
const TOTAL_INSTITUTIONS = "1,183";

// Lowercase noun phrase for prose; `weight` = how visible the line is to consumers and examiners.
const CAT = {
  overdraft: { noun: "overdraft fee", weight: 5 },
  nsf: { noun: "NSF / returned-item fee", weight: 5 },
  monthly_maintenance: { noun: "monthly maintenance fee", weight: 5 },
  atm_non_network: { noun: "non-network ATM fee", weight: 3 },
  deposited_item_return: { noun: "deposited-item return fee", weight: 3 },
  stop_payment: { noun: "stop-payment fee", weight: 2 },
  paper_statement: { noun: "paper statement fee", weight: 2 },
  card_replacement: { noun: "card replacement fee", weight: 2 },
  wire_domestic_outgoing: { noun: "outgoing domestic wire fee", weight: 2 },
  od_protection_transfer: { noun: "overdraft-protection transfer fee", weight: 2 },
  cashiers_check: { noun: "cashier's check fee", weight: 1 },
  wire_domestic_incoming: { noun: "incoming wire fee", weight: 1 },
  wire_intl_outgoing: { noun: "outgoing international wire fee", weight: 1 },
};
// Why the line matters, written for a bank or credit union pricing committee.
const WHY_ABOVE = {
  overdraft: "Overdraft pricing is the first line examiners, consumer advocates and comparison sites read.",
  nsf: "Returned-item fees remain under regulatory and competitive pressure, and a number of large institutions have eliminated them.",
  monthly_maintenance: "Maintenance fees are the line account shoppers compare first, before any penalty fee.",
  atm_non_network: "It recurs for every customer who banks outside your ATM footprint.",
  deposited_item_return: "This fee falls on the depositor for a check someone else wrote, which makes it a frequent example in fee-fairness criticism.",
  stop_payment: "It is infrequent, but it appears in most side-by-side schedule comparisons.",
  paper_statement: "Some institutions price it deliberately to move customers to e-statements; if that is the intent here, the premium is defensible.",
  card_replacement: "It is a small charge, typically incurred after a lost or compromised card, when customers are least forgiving.",
  wire_domestic_outgoing: "Wire fees fall mostly on business and higher-balance customers, the relationships most likely to compare institutions.",
  od_protection_transfer: "Customers who enroll in overdraft protection are doing what you ask; a premium transfer fee works against that.",
  cashiers_check: "It is infrequent and mostly a perception item.",
  wire_domestic_incoming: "Charging to receive funds is increasingly uncommon and is noticed by business customers.",
  wire_intl_outgoing: "Volumes are typically low; the premium matters mainly to the few customers who use the service.",
};
const LOOSE = {
  overdraft: /overdra|courtesy|paid item|bounce/i,
  nsf: /nsf|insufficient|non-?sufficient|return(ed)? item|unpaid/i,
  monthly_maintenance: /maintenance|monthly (service|fee)|service (charge|fee)|account fee/i,
  deposited_item_return: /deposit/i,
  atm_non_network: /atm|foreign/i,
};
const article = (noun) => (/^(a|e|i|o|u|nsf)/i.test(noun) ? "an " : "a ") + noun;
const PENALTY = new Set(["overdraft", "nsf", "deposited_item_return", "od_protection_transfer"]);
const closing = (f) => PENALTY.has(f.category)
  ? `A penalty fee offers little service to differentiate on, so the peer median of ${usd(f.peer_median)} is the natural reference point.`
  : f.category === "monthly_maintenance"
    ? "If the account carries waivers, the waiver terms matter more than the headline price; make sure they are as visible as the fee."
    : `Holding the premium is reasonable if the service behind it is differentiated; otherwise the peer median of ${usd(f.peer_median)} is the reference point.`;
const WHY_BELOW = {
  overdraft: "A below-market overdraft fee is a claim peers' own published schedules can substantiate.",
  nsf: "Below-market returned-item pricing is a position many institutions are moving toward.",
  monthly_maintenance: "Low-cost checking is the single most marketable fee position.",
};

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const usd = (v) => {
  const n = r2(v);
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
};
const ordinal = (n) => {
  const v = Math.round(n), s = ["th", "st", "nd", "rd"], m = v % 100;
  return `${v}${s[(m - 20) % 10] || s[m] || s[0]}`;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const listJoin = (xs) => xs.length <= 1 ? xs.join("") : xs.length === 2 ? `${xs[0]} and ${xs[1]}`
  : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"];
const count = (n) => COUNT_WORDS[n] ?? String(n);

const TIER_BANDS = { community_small: [0, 300], community_mid: [300, 1000], community_large: [1000, 10000] };
const fmtM = (m) => m >= 1000 ? `$${m / 1000}B` : `$${m}M`;
export function cohortPhrase(meta, inst) {
  const noun = inst.charter_type === "credit_union" ? "credit unions" : "banks";
  if (meta.cohort_scope === "national_widened") {
    const tiers = (meta.cohort_tiers ?? []).map((t) => TIER_BANDS[t]).filter(Boolean);
    const lo = Math.min(...tiers.map((t) => t[0])), hi = Math.max(...tiers.map((t) => t[1]));
    const band = lo === 0 ? `under ${fmtM(hi)} in assets` : `${fmtM(lo)}–${fmtM(hi)} in assets`;
    return { noun, where: "nationwide", band, widened: true, local: false };
  }
  return { ...scopePhrase(meta, inst), band: null, widened: false };
}
function scopePhrase(meta, inst) {
  const noun = inst.charter_type === "credit_union" ? "credit unions" : "banks";
  if (meta.cohort_scope === "state") return { noun, where: `in ${STATE_NAMES[inst.state_code] ?? inst.state_code}`, local: true };
  if (meta.cohort_scope === "district") return { noun, where: `in the ${ordinal(inst.fed_district)} Federal Reserve District`, local: true };
  return { noun, where: "nationwide", local: false };
}
const STATE_NAMES = { AL: "Alabama", AZ: "Arizona", CA: "California", CO: "Colorado", FL: "Florida", GA: "Georgia",
  IL: "Illinois", IN: "Indiana", LA: "Louisiana", MD: "Maryland", MI: "Michigan", MN: "Minnesota", NC: "North Carolina",
  NY: "New York", OH: "Ohio", TN: "Tennessee", TX: "Texas", VA: "Virginia", WA: "Washington", WV: "West Virginia" };

function rankPhrase(f) {
  if (f.percentile >= 100) return `the highest of the ${f.peer_count} peers that publish it`;
  if (f.percentile <= 0) return `the lowest of the ${f.peer_count} peers that publish it`;
  return `the ${ordinal(f.percentile)} percentile of ${f.peer_count} peers`;
}

function narrate(id) {
  const pack = JSON.parse(readFileSync(join(DIR, "packs", `${id}.json`), "utf8"));
  const inst = pack.institution, meta = pack.meta;
  const name = inst.institution_name;
  const sc = cohortPhrase(meta, inst);
  const fees = pack.fees.map((f) => ({ ...f, ...CAT[f.category] }));

  const ranked = fees.filter((f) => f.their_value != null && f.percentile != null);
  const above = ranked.filter((f) => f.flag === "well_above" || f.flag === "above_band")
    .map((f) => ({ ...f, score: f.weight * (f.their_value / Math.max(f.peer_median, 0.01)) }))
    .sort((a, b) => b.score - a.score);
  const below = ranked.filter((f) => f.flag === "below_band" || f.flag === "free")
    .sort((a, b) => b.weight - a.weight || a.percentile - b.percentile);
  const inBand = ranked.filter((f) => !f.flag);
  const thin = fees.filter((f) => f.their_value != null && f.percentile == null);
  // Only call a fee missing when nothing resembling it appears anywhere in the full schedule;
  // a loosely matching line means it is published under a label the category rules declined.
  const listed = (cat) => (pack.all_fees ?? []).some((a) => LOOSE[cat]?.test(a.fee_name));
  const gaps = fees.filter((f) => f.flag === "data_gap" && f.weight >= 3 && !listed(f.category));

  const vsMedian = (f) => {
    const ratio = f.their_value / f.peer_median;
    return f.flag === "well_above" && f.peer_median > 0
      ? `${ratio.toFixed(1).replace(/\.0$/, "")}× the ${usd(f.peer_median)} peer median`
      : `${usd(f.their_value - f.peer_median)} above the ${usd(f.peer_median)} peer median`;
  };

  // ---------- Candidate findings, in priority order ----------
  const cands = [];
  const aboveFinding = (f) => ({
    stat: `${usd(f.their_value)} vs ${usd(f.peer_median)}`,
    stat_label: `${f.noun}, yours vs peer median`,
    headline: `Your ${f.noun} is ${f.flag === "well_above" ? "well above" : "above"} the market range.`,
    body: `At ${usd(f.their_value)}, it is ${vsMedian(f)} and ${rankPhrase(f)} (middle half of the market: ${usd(f.peer_p25)}–${usd(f.peer_p75)}). ${WHY_ABOVE[f.category]}`,
    quote: `Your ${f.noun} (${usd(f.their_value)}) is ${vsMedian(f)}, ${rankPhrase(f)}.`,
  });
  if (above[0]) cands.push(aboveFinding(above[0]));
  const belowCand = (() => {
    if (!below.length) return null;
    const b = below.slice(0, 3);
    const lead = b[0];
    const parts = b.map((f) => `${f.noun} (${usd(f.their_value)} vs a ${usd(f.peer_median)} median)`);
    return {
      stat: below.length > 1 ? `${below.length} lines` : `${usd(lead.their_value)} vs ${usd(lead.peer_median)}`,
      stat_label: below.length > 1 ? "priced below the market range" : `${lead.noun}, yours vs peer median`,
      headline: below.length > 1 ? "Several lines are priced below the market." : `Your ${lead.noun} is priced below the market.`,
      body: `Your ${listJoin(parts)} ${b.length > 1 ? "each sit" : "sits"} below the peer 25th percentile. ${WHY_BELOW[lead.category] ?? (b.length > 1 ? "These are customer-favorable positions that peers' published schedules can verify." : "It is a customer-favorable position that peers' published schedules can verify.")}${lead.weight >= 3 ? " If the pricing is deliberate, it is worth stating plainly in account marketing." : ""}`,
      quote: `Your ${parts[0]} ${b.length > 1 ? "and " + count(b.length - 1) + " other line" + (b.length > 2 ? "s" : "") + " sit" : "sits"} below the market range.`,
      weight: lead.weight,
    };
  })();
  if (belowCand && belowCand.weight >= 2) cands.push(belowCand);
  if (above[1]) {
    const rest = above.slice(1, 4);
    if (rest.length === 1) cands.push(aboveFinding(rest[0]));
    else cands.push({
      stat: `${rest.length} more`,
      stat_label: "lines above the market range",
      headline: "Smaller premiums elsewhere on the schedule.",
      body: `${cap(listJoin(rest.map((f) => `your ${f.noun} (${usd(f.their_value)} vs a ${usd(f.peer_median)} median, n=${f.peer_count})`)))} also sit above the peer 75th percentile. Individually modest, together they shape how the schedule reads in a side-by-side comparison.`,
      quote: null,
    });
  }
  if (ranked.length) cands.push({
    stat: `${inBand.length} of ${ranked.length}`,
    stat_label: "comparable lines inside the market range",
    headline: inBand.length === ranked.length ? "Your schedule is priced in line with the market." : "Most of your schedule is priced with the market.",
    body: `Of the ${ranked.length} fee lines where we found both your published amount and at least eight comparable peers, ${count(inBand.length)} ${inBand.length === 1 ? "sits" : "sit"} between the peer 25th and 75th percentiles${above.length ? `, ${count(above.length)} above` : ""}${below.length ? ` and ${count(below.length)} below` : ""}.${inBand.length === ranked.length ? " No line stands out as a pricing risk; the opportunity is in how the schedule is presented, not in what it charges." : ""}`,
    quote: inBand.length === ranked.length ? `All ${ranked.length} of your fee lines with enough peer data sit inside the middle half of the market.` : null,
  });
  if (belowCand && belowCand.weight < 2) cands.push(belowCand);
  if (gaps.length) cands.push({
    stat: `${gaps.length} ${gaps.length === 1 ? "fee" : "fees"}`,
    stat_label: "not found in your published schedule",
    headline: "Some headline fees are not in the schedule we found.",
    body: `We did not find ${listJoin(gaps.map((f) => article(f.noun)))} in your published documents, although ${gaps.map((f) => f.peer_count).sort((a, b) => b - a)[0]} or more peers publish one. If you charge ${gaps.length === 1 ? "it" : "them"}, the amount may sit in a separate disclosure; customers comparing schedules online will not see it.`,
    quote: null,
  });
  const fe = pack.fee_econ ?? {};
  if (fe.intensity_pctile != null && fe.mine?.intensity_bps != null) cands.push({
    stat: `${ordinal(fe.intensity_pctile)}`,
    stat_label: "percentile, fee income relative to assets",
    headline: fe.intensity_pctile >= 60 ? "Fee income is a larger contributor than at most peers."
      : fe.intensity_pctile <= 40 ? "Fee income is a smaller contributor than at most peers." : "Fee income is in line with peers.",
    body: `Service-charge income was ${Number(fe.mine.intensity_bps).toFixed(1)} basis points of assets in your latest full-year filing, against a ${Number(fe.cohort.intensity_median).toFixed(1)} bps median for ${Number(fe.cohort.n).toLocaleString("en-US")} same-size ${sc.noun}. ${fe.intensity_pctile >= 60 ? "Pricing changes carry more revenue weight here than for a typical peer, so any change should be modeled against actual incidence." : fe.intensity_pctile <= 40 && above.length ? "That gives room to adjust the lines flagged in this report at limited revenue cost." : ""}`.trim(),
    quote: null,
  });
  const findings = cands.slice(0, 3);
  const quote = findings.find((f) => f.quote)?.quote ?? cands.find((c) => c.quote)?.quote ?? null;

  // ---------- Executive narrative ----------
  const cohortSentence = sc.widened
    ? `${name} is compared with ${meta.cohort_size} ${sc.noun} ${sc.band} nationwide that publish fee schedules in the Bank Fee Index. The size band is wider than usual because fewer than 40 ${sc.noun} in your own size tier have published data; local competitors may price differently.`
    : `${name} is compared with ${meta.cohort_size} ${sc.noun} of similar size ${sc.where} that publish fee schedules in the Bank Fee Index${sc.local ? "" : `; a national set is used because fewer than 15 same-size peers in ${STATE_NAMES[inst.state_code] ?? inst.state_code} have published data, so local competitors may price differently`}.`;
  const posture = ranked.length < 3
    ? `Only ${count(ranked.length)} of your fee lines ${ranked.length === 1 ? "has" : "have"} enough comparable peers to rank, so this report is directional; the named comparison in § 05 is the most useful page.`
    : above.length === 0 && below.length === 0
      ? `All ${ranked.length} rankable lines sit inside the middle half of the market. This is a conventional, defensible schedule.`
      : `Of ${ranked.length} rankable lines, ${count(inBand.length)} sit inside the middle half of the market${above.length ? `, ${count(above.length)} above it (${listJoin(above.map((f) => f.noun))})` : ""}${below.length ? `${above.length ? "," : ""} and ${count(below.length)} below it (${listJoin(below.map((f) => f.noun))})` : ""}.`;
  const recs = [];
  if (above.length) recs.push(`review the ${above[0].noun}, which sits ${above[0].flag === "well_above" ? "well " : ""}above the market range; the peer median of ${usd(above[0].peer_median)} is the reference point`);
  if (below.length && below[0].weight >= 3) recs.push(`state the below-market ${below[0].noun} in account marketing, where peers' published schedules make it verifiable`);
  if (gaps.length) recs.push(`check that the ${listJoin(gaps.map((f) => f.noun.replace(/ fee$/, "")))} ${gaps.length === 1 ? "fee is" : "fees are"} published where customers can find ${gaps.length === 1 ? "it" : "them"}`);
  const recSentence = recs.length
    ? (recs.length === 1 ? `We would suggest one step: ${recs[0]}.` : `We would suggest ${count(Math.min(recs.length, 3))} steps, in order of value: ${recs.slice(0, 3).map((r, i) => `(${i + 1}) ${r}`).join("; ")}.`)
    : "No change is indicated by the published data; the value of this report is in confirming that position and tracking peers as they move.";
  const exec_narrative = `${cohortSentence} ${posture} ${recSentence}`;

  // ---------- Callouts (the § 03 page) ----------
  const callouts = [];
  for (const f of above.slice(0, 3)) callouts.push({
    kind: "risk",
    title: `${cap(f.noun)} — ${usd(f.their_value)}`,
    stat: `Peer median ${usd(f.peer_median)} · middle half ${usd(f.peer_p25)}–${usd(f.peer_p75)} · range ${usd(f.peer_min)}–${usd(f.peer_max)} · ${ordinal(f.percentile)} percentile · n=${f.peer_count}`,
    body: `Published as “${f.their_fee_name}.” At ${usd(f.their_value)} it is ${vsMedian(f)}. ${WHY_ABOVE[f.category]} ${closing(f)}`,
  });
  for (const f of below.slice(0, 2)) callouts.push({
    kind: "opportunity",
    title: `${cap(f.noun)} — ${usd(f.their_value)}`,
    stat: `Peer median ${usd(f.peer_median)} · middle half ${usd(f.peer_p25)}–${usd(f.peer_p75)} · ${ordinal(f.percentile)} percentile · n=${f.peer_count}`,
    body: f.weight >= 3
      ? `Published as “${f.their_fee_name}.” ${WHY_BELOW[f.category] ?? "This is a customer-favorable position."} If it is a deliberate choice, it belongs in account marketing; if it is an old price that was never revisited, the median of ${usd(f.peer_median)} is the reference point.`
      : `Published as “${f.their_fee_name}.” A customer-favorable price on a low-volume line. No action is indicated unless it is an old price that was never revisited, in which case the peer median of ${usd(f.peer_median)} is the reference point.`,
  });
  if (gaps.length && callouts.length < 4) callouts.push({
    kind: "risk",
    title: "Fees we could not find in your published schedule",
    stat: gaps.map((f) => `${cap(f.noun)}: published by ${f.peer_count} peers (median ${usd(f.peer_median)})`).join(" · "),
    body: "Absence here means the line was not in the documents listed in § 06, not that you do not charge it. Regulators and comparison sites increasingly expect the full consumer fee schedule to be posted in one place.",
  });
  if (thin.length && callouts.length < 4) callouts.push({
    kind: "opportunity",
    title: "Lines with too few peers to rank",
    stat: thin.map((f) => `${cap(f.noun)} ${usd(f.their_value)} (n=${f.peer_count}${f.peer_count ? `, median ${usd(f.peer_median)}` : ""})`).join(" · "),
    body: "Fewer than eight comparable peers publish these lines, so we show them without a percentile or a flag. Treat any comparison as directional.",
  });
  if (!callouts.length) callouts.push({
    kind: "opportunity",
    title: "No line falls outside the market range",
    stat: `${ranked.length} lines ranked against ${meta.cohort_size} peers`,
    body: "Every rankable line sits between the peer 25th and 75th percentiles. The schedule does not present a pricing risk; the remaining question is whether it is presented as clearly as competitors present theirs.",
  });

  // ---------- Market context (§ 06) ----------
  const context_narrative = [
    `<p>Overdraft and returned-item fees have been the focus of regulatory and public attention since 2022, and many of the largest banks have reduced overdraft fees or eliminated NSF fees outright. Community institutions have moved more slowly and more unevenly, which is why the spread inside a peer set is often wider than the headline national averages suggest.</p>`,
    `<p>Fee schedules are also now public in a practical sense: they are collected, compared and summarized automatically. A customer or examiner comparing ${name} with its peers sees the same published lines this report uses, so the schedule is a positioning document as much as a pricing one.</p>`,
    `<p>How to use this report: § 02 shows every line against the peer range; § 03 explains the lines that sit outside it; § 05 names peers line by line. Ranked comparisons require at least eight peers publishing the same line. Where your institution offers several amounts for one category, the report uses the standard consumer charge described in the methodology below.</p>`,
  ].join("");

  const out = {
    generated_by: "narrate.mjs",
    contact_email: CONTACT_EMAIL,
    total_institutions: TOTAL_INSTITUTIONS,
    quote,
    findings: findings.map(({ quote: _q, weight: _w, ...f }) => f),
    exec_narrative,
    callouts: callouts.slice(0, 4),
    context_narrative,
    unclassified: fees.filter((f) => f.their_value == null && listed(f.category)).map((f) => f.category),
    summary: { ranked: ranked.length, above: above.map((f) => f.category), below: below.map((f) => f.category), gaps: gaps.map((f) => f.category), thin: thin.length },
  };
  writeFileSync(join(DIR, "narratives", `${id}.json`), JSON.stringify(out, null, 2) + "\n");
  return out;
}

for (const id of ids) {
  const o = narrate(id);
  console.log(`${id}\tranked=${o.summary.ranked} above=${o.summary.above.join(",") || "-"} below=${o.summary.below.join(",") || "-"} gaps=${o.summary.gaps.join(",") || "-"}`);
}
