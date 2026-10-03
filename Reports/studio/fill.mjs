#!/usr/bin/env node
// Studio filler: template.html + packs/<id>.json + narratives/<id>.json -> out/<id>.html
// No dependencies. Usage: node fill.mjs <institution_id> [--sample]
//   --sample  anonymize the client (name only; peers stay named), swap the back page for
//             the public-sample CTA, and write sample/sample-competitive-fee-position.html
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const SAMPLE = args.includes("--sample");
const id = args.find((a) => !a.startsWith("--"));
if (!id) { console.error("usage: node fill.mjs <institution_id> [--sample]"); process.exit(1); }

const SAMPLE_NAME = "Sample Community Bank";
const SAMPLE_PLACE = "San Francisco Fed district";

const pack = JSON.parse(readFileSync(join(DIR, "packs", `${id}.json`), "utf8"));
const narr = JSON.parse(readFileSync(join(DIR, "narratives", `${id}.json`), "utf8"));
let html = readFileSync(join(DIR, "template.html"), "utf8");

const DISPLAY = {
  monthly_maintenance: "Monthly maintenance", overdraft: "Overdraft",
  nsf: "NSF / returned item", atm_non_network: "Non-network ATM",
  card_foreign_txn: "Foreign transaction", wire_domestic_outgoing: "Outgoing domestic wire",
  stop_payment: "Stop payment", wire_intl_outgoing: "Outgoing intl. wire",
  wire_domestic_incoming: "Incoming domestic wire", cashiers_check: "Cashier's check",
  od_protection_transfer: "OD protection transfer", paper_statement: "Paper statement",
  minimum_balance: "Minimum balance", card_replacement: "Card replacement",
  deposited_item_return: "Deposited item return",
};
// Asset tiers match the site's public segment labels (src/app/(public)/institution/[id]/enum-labels.ts).
const TIER_BANDS = {
  community_small: "under $300M",
  community_mid: "$300M–$1B",
  community_large: "$1B–$10B",
  regional: "$10B–$50B",
};
const tierLabel = (tier, charter, plural = false) => {
  const band = TIER_BANDS[tier];
  const noun = charter === "credit_union" ? "credit union" : "bank";
  const head = plural ? `Community ${noun}s` : `Community ${noun}`;
  return band ? `${head}, ${band}` : `${head} (${String(tier).replaceAll("_", " ")})`;
};
// One date format everywhere: "Aug 16, 2026".
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return iso ?? "—";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};
const money = (v) => (v === null || v === undefined) ? "—" : `$${Number(v).toFixed(2)}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const inst = pack.institution;
const fees = pack.fees;
const realName = inst.institution_name;
const shownName = SAMPLE ? SAMPLE_NAME : realName;
// In sample mode the client's name (and its initials, e.g. "CBSM ATMs") is replaced wherever the
// narratives or fee lines mention it; peers keep their real names.
const initials = realName.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && w.length > 2).map((w) => w[0]).join("");
const anon = (text) => {
  if (!SAMPLE) return String(text);
  let out = String(text).replaceAll(realName, SAMPLE_NAME);
  if (initials.length >= 3) out = out.replace(new RegExp(`\\b${initials}\\b`, "g"), "network");
  return out;
};

// Position rows: every category, with the published line we used so the reader can check it.
const unclassified = new Set(narr.unclassified ?? []);
const TAGS = {
  well_above: `<span class="tag above">2× median</span>`,
  above_band: `<span class="tag above">above range</span>`,
  below_band: `<span class="tag below">below range</span>`,
  free: `<span class="tag below">no fee</span>`,
  thin_peer_data: `<span class="tag gap">few peers</span>`,
};
const positionRows = fees.map((f) => {
  const p = f.percentile === null || f.percentile === undefined ? null : Number(f.percentile);
  const barClass = f.flag === "well_above" || f.flag === "above_band" ? "hi"
    : f.flag === "below_band" || f.flag === "free" ? "lo" : "";
  const missing = f.their_value === null || f.their_value === undefined;
  const bar = missing
    ? `<span class="small muted">${unclassified.has(f.category) ? "listed under another label — see appendix" : "not in published schedule"}</span>`
    : p === null
      ? `<span class="small muted">fewer than 8 peers publish it</span>`
      : `<div class="bar-wrap"><div class="bar ${barClass}" style="width:${Math.max(p, 2)}%"></div></div><span class="small muted"> P${p}</span>`;
  const line = String(f.their_fee_name ?? "");
  const short = line.length > 46 ? `${line.slice(0, 44).replace(/[\s,;(–-]+$/, "")}…` : line;
  const label = missing ? "" : `<span class="feeline">${esc(anon(short))}${f.has_zero_tier ? " · $0 option" : ""}</span>`;
  return `<tr><td><span class="cat">${DISPLAY[f.category] ?? f.category}</span>${label}</td>
    <td class="r"><b>${money(f.their_value)}</b></td>
    <td class="r">${money(f.peer_p25)}</td><td class="r">${money(f.peer_median)}</td>
    <td class="r">${money(f.peer_p75)}</td><td class="r muted">${f.peer_count || "—"}</td>
    <td>${bar}</td><td>${TAGS[f.flag] ?? ""}</td></tr>`;
}).join("\n");

// Exec findings (3 numbers) from narratives; shrink long stats so the column holds
const execFindings = narr.findings.map((f) => {
  const size = f.stat.length > 12 ? "13pt" : f.stat.length > 8 ? "18pt" : "24pt";
  return `<div class="finding"><div class="num" style="font-size:${size}">${esc(f.stat)}<small>${esc(f.stat_label)}</small></div>
   <p><b>${esc(anon(f.headline))}</b>${esc(anon(f.body))}</p></div>`;
}).join("\n");

// Callout cards
const callouts = narr.callouts.map((c) =>
  `<div class="callout ${c.kind === "opportunity" ? "opportunity" : ""}">
     <h3>${esc(anon(c.title))}</h3><div class="stat">${esc(anon(c.stat))}</div><p>${esc(anon(c.body))}</p>
   </div>`).join("\n");

// Some registry names arrive fully uppercase (e.g. "FIDELITY BANK"); title-case those
// for display, preserving short acronym tokens (FCU, FSB, N.A.) and lowercase connectives.
const SMALL_WORDS = new Set(["of", "the", "and", "for", "in", "at", "on"]);
const ACRONYMS = new Set(["fcu", "cu", "fsb", "na", "n.a.", "usa", "us", "ny", "la"]);
function displayName(name) {
  if (!name || name !== name.toUpperCase() || !/[A-Z]{3}/.test(name)) return name;
  return name.toLowerCase().split(" ").map((w, i) => {
    if (ACRONYMS.has(w) || (!/[aeiouy]/.test(w) && /[a-z]/.test(w))) return w.toUpperCase();
    if (i > 0 && SMALL_WORDS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

// Peer table: pick 5 headline categories with best coverage
const WEIGHT = { overdraft: 5, nsf: 5, monthly_maintenance: 5, atm_non_network: 3, deposited_item_return: 3 };
const HEADLINE = fees.filter((f) => f.their_value != null)
  .map((f) => ({ k: f.category, cov: (pack.peers ?? []).filter((p) => p.fees?.[f.category] != null).length }))
  .filter((x) => x.cov >= 2)
  .sort((a, b) => (WEIGHT[b.k] ?? 1) - (WEIGHT[a.k] ?? 1) || b.cov - a.cov)
  .slice(0, 5).map((x) => x.k);
const peerHead = HEADLINE.map((k) => `<th class="r">${DISPLAY[k]}</th>`).join("");
const selfRow = HEADLINE.map((k) => {
  const f = fees.find((x) => x.category === k);
  return `<td class="r">${money(f?.their_value)}</td>`;
}).join("");
const peerRows = (pack.peers ?? []).map((p) =>
  `<tr><td>${esc(displayName(p.institution_name))} <span class="small muted">(${esc(p.city)}, ${esc(p.state_code)})</span></td>` +
  HEADLINE.map((k) => `<td class="r">${money(p.fees?.[k])}</td>`).join("") + `</tr>`).join("\n");

// Appendix: complete published schedule
const allFees = pack.all_fees ?? [];
const FREQ = { per_occurrence: "per occurrence", one_time: "one-time", monthly: "monthly",
  annual: "annual", daily: "daily", per_item: "per item", per_page: "per page" };
const allFeesRows = allFees.map((a) => {
  if (a.terms !== undefined) {
    return `<tr><td>${esc(anon(a.fee_name))}</td><td class="r"><b>${money(a.amount)}</b></td>
    <td class="small muted">${esc(anon(a.terms || "—"))}</td></tr>`;
  }
  let freq = FREQ[a.frequency] ?? (a.frequency ?? "").replaceAll("_", " ");
  // Caps read as limits, not charges ("daily maximum", not a scary bare "daily")
  if (a.is_fee_cap) freq = freq ? `${freq} maximum` : "maximum";
  const terms = [freq, a.conditions].filter(Boolean).join(" · ");
  return `<tr><td>${esc(anon(a.fee_name))}</td><td class="r"><b>${money(a.amount)}</b></td>
    <td class="small muted">${esc(anon(terms || "—"))}</td></tr>`;
}).join("\n");

// Provenance: source documents
// In sample mode the client's own URLs would identify it, so they are summarized instead.
const sourceList = SAMPLE
  ? `<li>${(pack.sources ?? []).length || 1} published fee schedule document${(pack.sources ?? []).length > 1 ? "s" : ""} on the institution's website <span class="muted">(URL withheld in this sample)</span></li>`
  : (pack.sources ?? []).map((s) =>
    `<li>${esc(s.url)}${s.n_fees ? ` <span class="muted">(${s.n_fees} fee lines)</span>` : ""}</li>`).join("\n")
    || `<li>${esc(inst.institution_name)} published fee schedule</li>`;

// Revenue lens (FDIC/NCUA Call Report data)
const fin = pack.financials ?? {};
const fl = fin.latest ?? {}, fy = fin.last_full_year ?? {}, fc = fin.cohort ?? {};
const isCU = inst.charter_type === "credit_union";
const kUSD = (v) => { // values filed in $thousands
  if (v === null || v === undefined) return "—";
  const d = v * 1000;
  if (d >= 1e9) return `$${(d / 1e9).toFixed(2)}B`;
  if (d >= 1e6) return `$${(d / 1e6).toFixed(1)}M`;
  return `$${Math.round(d).toLocaleString()}`;
};
const pct = (v, d = 2) => (v === null || v === undefined) ? "—" : `${(v * 100).toFixed(d)}%`;
const card = (lbl, val, cmp = "") =>
  `<div class="statcard"><div class="lbl">${lbl}</div><div class="val">${val}</div>${cmp ? `<div class="cmp">${cmp}</div>` : ""}</div>`;

const scRatio = fy.sc_per_assets, scMed = fc.sc_per_assets_median;
const intensity = (scRatio != null && scMed != null && scMed > 0) ? scRatio / scMed : null;
const finCards = [
  card("Total assets", kUSD(fl.total_assets)),
  card("Total deposits", kUSD(fl.total_deposits)),
  card(isCU ? "Members" : "Employees",
    (isCU ? fl.member_count : fl.employee_count)?.toLocaleString?.() ?? "—",
    fl.branch_count ? `${fl.branch_count} branches` : ""),
  card("Service-charge income", kUSD(fy.service_charge_income),
    fy.fee_income_ratio != null ? `${pct(fy.fee_income_ratio, 1)} of revenue` : "as filed"),
  card("Fee-income intensity",
    scRatio != null ? `${(scRatio * 10000).toFixed(1)} bps` : "—",
    scMed != null ? `cohort median <b>${(scMed * 10000).toFixed(1)} bps</b> of assets` : "of assets"),
  // NCUA filings often lack ROA — only show the card when both sides are real
  (fl.roa && fc.roa_median)
    ? card("Return on assets", `${fl.roa}%`, `cohort median <b>${fc.roa_median}%</b>`)
    : card("Fee schedule", `${fees.filter((x) => x.their_value !== null).length} of ${fees.length}`,
        "featured categories published"),
].join("\n");

// Fee economics per the fee-revenue-correlation methodology
const fe = pack.fee_econ ?? {};
const me = fe.mine ?? {}, co = fe.cohort ?? {};
const bps = (v) => (v == null) ? "—" : `${Number(v).toFixed(1)} bps`;
const pc = (v, d = 1) => (v == null) ? "—" : `${(v * 100).toFixed(d)}%`;
const assess = (mine, med, hiWord, loWord) =>
  mine == null || med == null ? "—"
    : mine > med * 1.3 ? hiWord : mine < med * 0.7 ? loWord : "In line";
const econRow = (metric, you, p25, med, p75, pctile, assessment) =>
  `<tr><td>${metric}</td><td class="r"><b>${you}</b></td><td class="r">${p25}</td>
   <td class="r">${med}</td><td class="r">${p75}</td>
   <td>${pctile != null ? `P${pctile}` : "—"}</td><td>${assessment}</td></tr>`;
const econTable = [
  econRow("Service-charge income", kUSD(me.sc), "—", kUSD(co.sc_median), "—", null,
    assess(me.sc, co.sc_median, "Above cohort", "Below cohort")),
  econRow("Fee intensity (income / assets)", bps(me.intensity_bps), bps(co.intensity_p25),
    bps(co.intensity_median), bps(co.intensity_p75), fe.intensity_pctile,
    assess(me.intensity_bps, co.intensity_median, "Above cohort", "Below cohort")),
  econRow("Fee dependency (share of noninterest income)", pc(me.dependency),
    pc(co.dependency_p25), pc(co.dependency_median), pc(co.dependency_p75),
    fe.dependency_pctile, assess(me.dependency, co.dependency_median, "Higher share", "Lower share")),
  (me.fee_to_ni != null && co.fee_to_ni_median != null)
    ? econRow("Fee income vs. net income", pc(me.fee_to_ni), "—", pc(co.fee_to_ni_median),
      "—", null, assess(me.fee_to_ni, co.fee_to_ni_median, "Higher share", "Lower share"))
    : "",
].join("\n");

// Posted price vs realized fee income, stated as a reading of the numbers, not a conclusion.
const ordinal = (n) => { const v = Math.round(n), t = ["th", "st", "nd", "rd"], m = v % 100; return `${v}${t[(m - 20) % 10] || t[m] || t[0]}`; };
const pricePcts = fees.filter((x) => x.percentile != null).map((x) => Number(x.percentile));
const avgPricePct = pricePcts.length >= 3
  ? Math.round(pricePcts.reduce((a, b) => a + b, 0) / pricePcts.length) : null;
const iPct = fe.intensity_pctile;
let verdict = "";
if (avgPricePct != null && iPct != null) {
  const P = `${ordinal(avgPricePct)} percentile`, I = `${ordinal(iPct)} percentile`;
  const lead = `Across the ${pricePcts.length} lines we could rank, your posted prices average the ${P} of peers; service-charge income relative to assets sits at the ${I} of the same-size cohort.`;
  const v = avgPricePct >= 60 && iPct <= 40
    ? `${lead} One reading is that waivers, low incidence or account mix limit how often the higher-priced lines are charged. If so, those lines carry comparison risk with limited revenue behind them; your own incidence data would confirm it.`
    : avgPricePct >= 60 && iPct >= 60
    ? `${lead} Both sit above the middle of the market, so fee income is a meaningful contributor and any repricing should be modeled against actual incidence first.`
    : avgPricePct <= 40 && iPct >= 60
    ? `${lead} Prices below the middle with income above it suggests volume rather than price drives fee income.`
    : avgPricePct <= 40 && iPct <= 40
    ? `${lead} Both sit below the middle of the market: a consistently low-fee posture, and a marketable one if it is deliberate.`
    : `${lead} Neither is far from the middle of the market, so the individual lines flagged in § 02 are where the decisions are.`;
  verdict = `<p class="narrative" style="margin-top:10pt">${v}</p>`;
}

// Trend line from year-end filings
const hist = pack.fin_history ?? [];
let trendLine = "";
if (hist.length >= 2) {
  const pts = hist.map((h) => `${h.report_date.slice(0, 4)}: ${bps(h.intensity_bps)}`).join(" → ");
  trendLine = `<p class="small muted" style="margin-top:6pt">Fee-intensity trend (year-end filings): ${pts} · cohort median ${bps(co.intensity_median)}.</p>`;
}
const finNarr = "";
const dep = pack.deposits ?? {};
const depositLine = (dep.branch_rows > 0)
  ? `<p class="small muted" style="margin-top:6pt">Deposit footprint (FDIC Summary of Deposits, ${dep.sod_year}): ${dep.branch_rows} branch location${dep.branch_rows === 1 ? "" : "s"} across ${dep.counties} ${dep.counties === 1 ? "county" : "counties"} holding ${kUSD(dep.total_branch_deposits)} in deposits.</p>`
  : "";

// Cohort: who the institution is compared with, stated once and consistently.
const STATE = { AL: "Alabama", AZ: "Arizona", CA: "California", CO: "Colorado", FL: "Florida", GA: "Georgia", IL: "Illinois",
  IN: "Indiana", LA: "Louisiana", MD: "Maryland", MI: "Michigan", MN: "Minnesota", NC: "North Carolina", NY: "New York",
  OH: "Ohio", TN: "Tennessee", TX: "Texas", VA: "Virginia", WA: "Washington", WV: "West Virginia" };
const meta = pack.meta;
const nounPl = isCU ? "credit unions" : "banks";
const tierBounds = { community_small: [0, 300], community_mid: [300, 1000], community_large: [1000, 10000] };
const fmtM = (m) => m >= 1000 ? `$${m / 1000}B` : `$${m}M`;
let cohortWhere, cohortLabel;
if (meta.cohort_scope === "national_widened") {
  const t = (meta.cohort_tiers ?? []).map((x) => tierBounds[x]).filter(Boolean);
  const lo = Math.min(...t.map((x) => x[0])), hi = Math.max(...t.map((x) => x[1]));
  const band = lo === 0 ? `under ${fmtM(hi)}` : `${fmtM(lo)}–${fmtM(hi)}`;
  cohortLabel = `${isCU ? "Credit unions" : "Banks"}, ${band} · nationwide`;
  cohortWhere = `${nounPl} with ${lo === 0 ? `under ${fmtM(hi)}` : `${fmtM(lo)}–${fmtM(hi)}`} in assets nationwide (a wider size band than usual, because fewer than 40 ${nounPl} in your own size tier publish comparable data)`;
} else {
  const where = meta.cohort_scope === "state" ? `in ${STATE[inst.state_code] ?? inst.state_code}`
    : meta.cohort_scope === "district" ? `in the ${ordinal(inst.fed_district)} Federal Reserve District` : "nationwide";
  cohortLabel = `${tierLabel(inst.asset_size_tier, inst.charter_type, true)} · ${where}`;
  cohortWhere = `${nounPl} with ${TIER_BANDS[inst.asset_size_tier] ?? "similar"} in assets ${where}`;
}
const cohortNote = `Compared with ${meta.cohort_size} ${cohortWhere} that publish fee schedules in the Bank Fee Index. `
  + `Each fee is compared only with the peers that publish it; lines with fewer than eight such peers are shown but not ranked.`;
const methodText = `Fee data is drawn from institutions' published fee schedules, collected and verified by the
  Bank Fee Index pipeline and checked against each category's definition and a plausible price range. Peer cohort:
  ${meta.cohort_size} ${cohortWhere}. For each category the report uses one standard consumer charge per institution:
  the generic line rather than a channel-specific variant (online, branch, business), the per-item amount for penalty
  fees, and the lowest positive amount for monthly maintenance (entry checking); a $0 option is noted where one exists.
  A line is marked <i>above range</i> when it exceeds the peer 75th percentile, <i>2× median</i> when it is at least
  twice the peer median, and <i>below range</i> under the 25th percentile. Percentiles require at least eight peers
  publishing the same line. Data pulled ${fmtDate(meta.pull_date)}. Published amounts may not reflect
  account-specific waivers or negotiated pricing.`;

// Back page: about the analysis and how to reach us. No price, no pitch.
const backHeadline = `About this <em>analysis</em>`;
const backSub = `Prepared by Fee Insight from published fee schedules and public regulatory filings. The Bank Fee Index
  tracks the published fee schedules of ${narr.total_institutions ?? "1,100+"} U.S. banks and credit unions; every figure
  in this report can be traced to a public document.`;
const backCta = `<div>
      <h4>Corrections and questions</h4>
      <p>If a figure does not match your current schedule, send us the document and we will correct the index and
      reissue the report.</p>
    </div>
    <div>
      <h4>Contact</h4>
      <span class="mail">${narr.contact_email}</span>
      <p style="margin-top:8pt">feeinsight.com${SAMPLE ? " · feeinsight.com/for-institutions" : ""}</p>
    </div>`;

const repl = {
  DOC_TITLE: SAMPLE ? "Sample Competitive Fee Position Report" : "Competitive Fee Position Report",
  COHORT_NOTE: cohortNote,
  BACK_HEADLINE: backHeadline,
  BACK_SUB: backSub,
  BACK_CTA: backCta,
  FIN_CARDS: finCards,
  FIN_NARRATIVE: finNarr,
  ECON_TABLE: econTable,
  ECON_VERDICT: verdict,
  TREND_LINE: trendLine,
  DEPOSIT_LINE: depositLine,
  FIN_SOURCE_LABEL: (fl.source ?? "fdic").toUpperCase() + " Call Reports",
  FIN_LATEST_DATE: fmtDate(fl.report_date),
  FIN_YEAR_DATE: fmtDate(fy.report_date),
  FIN_COHORT_N: fc.n != null ? Number(fc.n).toLocaleString("en-US") : "—",
  SOURCE_LIST: sourceList,
  ALL_FEES_ROWS: allFeesRows,
  ALL_FEES_COUNT: allFees.length,
  INSTITUTION_NAME: esc(shownName),
  CITY_STATE: SAMPLE ? SAMPLE_PLACE : `${esc(displayName(inst.city))}, ${esc(inst.state_code)}`,
  CHARTER_LABEL: inst.charter_type === "credit_union" ? "Credit Union" : "Bank",
  TIER_LABEL: tierLabel(inst.asset_size_tier, inst.charter_type),
  PULL_DATE: fmtDate(pack.meta.pull_date),
  COHORT_LABEL: cohortLabel,
  METHOD_TEXT: methodText,
  COHORT_SIZE: pack.meta.cohort_size,
  TOTAL_INSTITUTIONS: narr.total_institutions ?? "1,100+",
  CONTACT_EMAIL: narr.contact_email,
  EXEC_FINDINGS: execFindings,
  EXEC_NARRATIVE: anon(narr.exec_narrative),
  POSITION_ROWS: positionRows,
  CALLOUTS: callouts,
  PEER_HEAD: peerHead,
  PEER_SELF_ROW: selfRow,
  PEER_ROWS: peerRows,
  CONTEXT_NARRATIVE: anon(narr.context_narrative),
};
for (const [k, v] of Object.entries(repl)) html = html.replaceAll(`{{${k}}}`, String(v));

const leftovers = html.match(/{{[A-Z_]+}}/g);
if (leftovers) { console.error("Unfilled placeholders:", leftovers); process.exit(1); }

if (SAMPLE && html.includes(realName)) {
  console.error(`Sample still mentions the client name "${realName}"`); process.exit(1);
}
const outPath = SAMPLE
  ? join(DIR, "sample", "sample-competitive-fee-position.html")
  : join(DIR, "out", `${id}.html`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(outPath);
