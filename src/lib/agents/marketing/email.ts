import { getDisplayName } from "@/lib/fee-taxonomy";
import { SITE_NAME, PRODUCT_NAME } from "@/lib/constants";
import type { FactBundle, FeeStat } from "./facts";
import type { MarketingFormatKey } from "./formats";

/**
 * The email Hamilton's marketing agent writes: copy from the model, tables from live data.
 * The model never writes a table; every figure in a table comes straight from the bundle,
 * and every number in the model's prose is checked against it before a draft is made.
 */

export interface EmailCopy {
  subjectA: string;
  subjectB: string;
  label: string;
  headline: string;
  intro: string;
  sections: Array<{ heading: string; body: string }>;
  /** Which table to show under the intro. */
  table: "national" | "state" | "charter" | "none";
}

/** Words a Fee Insight email never uses (Hamilton product direction: decision support, never "raise your fee"). */
export const BANNED_PHRASES = [/raise your fees?/i, /increase your fees?/i, /guarantee/i, /within \d+ (hours|days)/i, /\bfree trial\b/i];

export function copyProblems(copy: EmailCopy): string[] {
  const problems: string[] = [];
  if (!copy.subjectA || !copy.subjectB) problems.push("missing a subject variant");
  if (copy.subjectA === copy.subjectB) problems.push("the two subjects are identical");
  if ([copy.subjectA, copy.subjectB].some((subject) => subject.length > 70)) problems.push("a subject is over 70 characters");
  if (!copy.headline || !copy.intro) problems.push("missing headline or intro");
  const all = copyText(copy);
  for (const pattern of BANNED_PHRASES) if (pattern.test(all)) problems.push(`uses a banned phrase (${pattern.source})`);
  if (all.includes(PRODUCT_NAME)) problems.push(`names ${PRODUCT_NAME} in the copy (footer only)`);
  return problems;
}

export function copyText(copy: EmailCopy): string {
  return [copy.subjectA, copy.subjectB, copy.label, copy.headline, copy.intro, ...copy.sections.flatMap((s) => [s.heading, s.body])].join("\n");
}

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function row(cells: string[], head = false): string {
  const tag = head ? "th" : "td";
  return `<tr style="border-bottom:${head ? "2px solid #1c1c1c" : "1px solid #e6e0d4"};">${cells
    .map((cell, index) => `<${tag} align="${index === 0 ? "left" : "right"}">${cell}</${tag}>`)
    .join("")}</tr>`;
}

function statRows(stats: FeeStat[]): string {
  return stats
    .map((stat) => row([esc(getDisplayName(stat.key)), `<strong>${money(stat.median)}</strong>`, `${money(stat.p25)} to ${money(stat.p75)}`, stat.institutions.toLocaleString("en-US")]))
    .join("");
}

export function renderTable(kind: EmailCopy["table"], bundle: FactBundle): string {
  const open = '<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;">';
  if (kind === "national") {
    return `${open}${row(["Fee", "Median", "Middle half", "Institutions"], true)}${statRows(bundle.national)}</table>`;
  }
  if (kind === "state" && bundle.state) {
    const rows = bundle.state.fees
      .map((fee) => {
        const nat = bundle.national.find((n) => n.key === fee.key);
        return row([esc(getDisplayName(fee.key)), `<strong>${money(fee.median)}</strong>`, nat ? money(nat.median) : "n/a", fee.institutions.toLocaleString("en-US")]);
      })
      .join("");
    return `${open}${row(["Fee", esc(bundle.state.name), "National", "Institutions"], true)}${rows}</table>`;
  }
  if (kind === "charter") {
    const rows = bundle.byCharter
      .filter((r) => r.bank && r.creditUnion)
      .map((r) => row([esc(getDisplayName(r.key)), money(r.bank!.median), money(r.creditUnion!.median), `${r.bank!.institutions.toLocaleString("en-US")} / ${r.creditUnion!.institutions.toLocaleString("en-US")}`]))
      .join("");
    return `${open}${row(["Fee", "Banks", "Credit unions", "Institutions"], true)}${rows}</table>`;
  }
  return "";
}

function link(path: string, month: string, format: string, text: string): string {
  const url = `https://feeinsight.com${path}${path.includes("?") ? "&" : "?"}utm_source=mailerlite&utm_medium=email&utm_campaign=agent-${month}&utm_content=${format}`;
  return `<a href="${esc(url)}" style="color:#b3261e;">${esc(text)}</a>`;
}

const paragraphs = (text: string) =>
  text.split(/\n{2,}/).map((p) => `<p style="font-size:16px;line-height:1.55;margin:0 0 14px 0;">${esc(p.trim())}</p>`).join("");

/**
 * The full email in the Fee Insight layout: Fee Insight alone in the header, the product named once in the footer.
 * Without a mailing address the footer simply leaves that line out, so drafts can be reviewed and shown;
 * the send step adds the address (`withMailingAddress`) before anything goes out.
 * `whatsNew` (from `whats-new.ts`) adds one short "What's new" line above the footer when it has entries.
 */
export function renderEmail(
  copy: EmailCopy,
  bundle: FactBundle,
  format: string,
  mailingAddress: string | null,
  whatsNew: string[] = [],
): string {
  const table = renderTable(copy.table, bundle);
  const sources = `National figures as of ${esc(bundle.asOf)}, from ${bundle.liveFees.toLocaleString("en-US")} live fees across ${bundle.liveInstitutions.toLocaleString("en-US")} institutions. The middle half is the 25th to 75th percentile.`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(copy.headline)}</title></head>
<body style="margin:0;padding:0;background:#f6f3ec;font-family:Helvetica,Arial,sans-serif;color:#1c1c1c;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e0d4;">
<tr><td style="padding:28px 32px 8px 32px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;">${esc(SITE_NAME)}</td></tr>
<tr><td style="padding:16px 32px 0 32px;">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#b3261e;font-weight:bold;">${esc(copy.label)}</div>
<h1 style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.25;margin:8px 0 12px 0;font-weight:normal;text-wrap:balance;">${esc(copy.headline)}</h1>
${paragraphs(copy.intro)}
</td></tr>
${table ? `<tr><td style="padding:0 32px;">${table}<p style="font-size:13px;line-height:1.5;color:#5a5a5a;margin:8px 0 20px 0;">${sources}</p></td></tr>` : ""}
<tr><td style="padding:0 32px;">
${copy.sections.map((s) => `<h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;margin:8px 0 8px 0;font-weight:normal;">${esc(s.heading)}</h2>${paragraphs(s.body)}`).join("")}
<p style="font-size:16px;line-height:1.55;margin:6px 0 20px 0;">${link("/reports/benchmark/national", bundle.month, format, "Open the national report")} · ${link("/research", bundle.month, format, "Find your state")}</p>
</td></tr>
<tr><td style="padding:0 32px 28px 32px;">
<table role="presentation" width="100%" cellpadding="16" cellspacing="0" style="background:#f6f3ec;border-left:3px solid #b3261e;"><tr><td style="font-size:15px;line-height:1.55;">
<strong>Want your own institution against the competitors you name?</strong> We check that your market has enough published data, then reply with scope and price. ${link("/for-institutions?report=institution#report", bundle.month, format, "Request your report")}
</td></tr></table>
${whatsNew.length ? `<p style="font-size:14px;line-height:1.55;margin:20px 0 0 0;"><strong>What's new:</strong> ${esc(whatsNew.join(" "))}</p>` : ""}
<p style="font-size:15px;line-height:1.55;margin:20px 0 0 0;">Questions, or a fee you want us to look at? Just reply.<br>James Gilmore, Founder</p>
</td></tr>
<tr><td style="background:#f6f3ec;padding:20px 32px;font-size:12px;line-height:1.6;color:#5a5a5a;border-top:1px solid #e6e0d4;">
${esc(SITE_NAME)} · <a href="https://feeinsight.com" style="color:#5a5a5a;">feeinsight.com</a> · hello@bankfeeindex.com<br>
Data from the ${esc(PRODUCT_NAME)}, read from each institution's own published fee schedule.<br>
${mailingAddress ? `${esc(mailingAddress)}<br>\n` : ""}<a href="{$unsubscribe}" style="color:#5a5a5a;">Unsubscribe</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * The email with the postal address in its footer, just before the unsubscribe link.
 * Returns the html unchanged when the address is already there, and null when there is
 * no unsubscribe link to anchor it to (the send step then refuses that email).
 */
export function withMailingAddress(html: string, mailingAddress: string): string | null {
  const line = esc(mailingAddress);
  if (html.includes(line)) return html;
  const unsubscribe = html.match(/<a\b[^>]*\{\$unsubscribe\}/);
  if (!unsubscribe || unsubscribe.index === undefined) return null;
  return `${html.slice(0, unsubscribe.index)}${line}<br>\n${html.slice(unsubscribe.index)}`;
}

/** The writer's instructions. Numbers may only come from the bundle; the step checks that. */
export function writerPrompt({
  format,
  brief,
  bundle,
  lessons,
}: {
  format: MarketingFormatKey;
  brief: string;
  bundle: FactBundle;
  lessons: string[];
}): string {
  const facts = {
    month: bundle.month,
    as_of: bundle.asOf,
    live_institutions: bundle.liveInstitutions,
    live_fees: bundle.liveFees,
    national: bundle.national.map((f) => ({ fee: getDisplayName(f.key), ...f })),
    coverage_last_month: bundle.previousCoverage?.map((f) => ({ fee: getDisplayName(f.key), institutions: f.institutions })) ?? null,
    banks_vs_credit_unions: bundle.byCharter
      .filter((r) => r.bank && r.creditUnion)
      .map((r) => ({ fee: getDisplayName(r.key), bank: r.bank, credit_union: r.creditUnion })),
    state: bundle.state ? { name: bundle.state.name, fees: bundle.state.fees.map((f) => ({ fee: getDisplayName(f.key), ...f })) } : null,
  };
  return [
    `You write one marketing email for ${SITE_NAME} (feeinsight.com), which tracks the fees U.S. banks and credit unions publish in their own fee schedules.`,
    "Readers are marketing, product and pricing people at banks and credit unions. Write like a sharp industry analyst: plain, specific, no hype, no exclamation marks.",
    `Format this month: ${format}. ${brief}`,
    "Hard rules:",
    "- Use ONLY numbers that appear in FACTS (copy them exactly; a dollar difference between two FACTS numbers is fine). Never estimate, round differently or invent a number, percentage or date. Every number you write is checked, and any number not in FACTS rejects the email.",
    "- coverage_last_month is how many institutions stood behind each fee last month. Use it only to say coverage grew. Never describe a median as rising, falling or moving since last month: the difference mostly reflects which institutions were added, not price changes.",
    "- Never tell anyone to raise their fees. This is decision support: show where the market sits and what to ask.",
    "- Never promise a turnaround time. The institution report is priced on request.",
    `- Don't name "${PRODUCT_NAME}"; the footer does that.`,
    "- Two subject lines that test different angles (for example a number-led subject against a question). Each under 60 characters.",
    "- Keep it short: an intro of 2 to 3 sentences, then 1 to 3 short sections.",
    lessons.length ? `What earlier emails taught us:\n${lessons.map((l) => `- ${l}`).join("\n")}` : "There are no results from earlier emails yet.",
    "Pick the table every email carries: \"national\" for national fee tables, \"state\" if the email is about the FACTS state, or \"charter\" for banks against credit unions.",
    'Reply with JSON only: {"subjectA": "", "subjectB": "", "label": "short uppercase-style kicker, e.g. Fee Pulse · November 2026", "headline": "", "intro": "", "sections": [{"heading": "", "body": ""}], "table": "national|state|charter"}',
    `FACTS:\n${JSON.stringify(facts)}`,
  ].join("\n\n");
}
