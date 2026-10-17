// Renders the Fee Insight email program (content.mjs) into MailerLite-ready files:
//   out/<automation>/<nn>-<slug>.html  — paste into MailerLite "Custom HTML"
//   out/<automation>/<nn>-<slug>.txt   — paste into the plain-text version
//   out/index.html                     — one-page preview of every email
// Usage: node Reports/studio/email-campaigns/build.mjs
// Email-safe HTML only: tables, inline styles, no web fonts. The one image is the header logo
// (LOGO_URL); its alt text renders as the wordmark when images are off.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROGRAM, BRAND } from "./content.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");

// The Fee Insight design system (src/brand/tokens): Oxford Navy ink and brick on parchment.
// Old key names stay (terra = brick) so the renderers below read the same.
const C = {
  ink: "#132338", ink2: "#132338", text2: "#55606f", muted: "#55606f",
  paper: "#fbf9f4", cream: "#fbf9f4", sand: "#f3efe6",
  terra: "#b23a32", terraSoft: "#f1d5d0", good: "#3b6350", goodSoft: "#e3ebe6",
  line: "#ddd5c6",
};
// Geist where the mail client has it, then close system faces; the brand has no serif.
const SANS = "Geist,Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
const SERIF = SANS;
// The site header logo (public/brand), served from the live site; mail clients block SVG, so PNG at 2x.
// The email logo is the wordmark in brick on a transparent background: Gmail dark mode inverts
// the parchment header but leaves images alone, and brick stays readable on both.
const LOGO_URL = "https://feeinsight.com/brand/png/fee-insight-oneline-email@2x.png";
const MONO = "'Geist Mono','SFMono-Regular',Menlo,Consolas,monospace";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Inline markup in copy: **bold** and [text](url).
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, t, u) => `<a href="${u}" style="color:${C.terra};text-decoration:underline;">${t}</a>`);
const plain = (s) => String(s).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
const money = (v) => (v === 0 ? "$0" : Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

function utm(url, automation, email) {
  if (!url.startsWith(BRAND.siteUrl)) return url;
  // Tracking goes in the query, before any #fragment, or the browser never sends it.
  const [base, hash] = url.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}utm_source=mailerlite&utm_medium=email&utm_campaign=${automation}&utm_content=${email}${hash ? `#${hash}` : ""}`;
}

// ---------- block renderers (html, text) ----------
const P = `margin:0 0 16px;font-family:${SERIF};font-size:17px;line-height:1.6;color:${C.ink2};`;

const R = {
  kicker: (b) => [
    `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.terra};">${esc(b.text)}</p>`,
    b.text.toUpperCase(),
  ],
  h1: (b) => [
    `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:30px;line-height:1.18;font-weight:normal;color:${C.ink};text-wrap:balance;overflow-wrap:anywhere;">${inline(b.text)}</h1>`,
    `${plain(b.text)}\n${"=".repeat(Math.min(plain(b.text).length, 60))}`,
  ],
  h2: (b) => [
    `<h2 style="margin:28px 0 10px;font-family:${SERIF};font-size:21px;line-height:1.3;font-weight:normal;color:${C.ink};">${inline(b.text)}</h2>`,
    `\n${plain(b.text).toUpperCase()}`,
  ],
  p: (b) => [`<p style="${P}">${inline(b.text)}</p>`, plain(b.text)],
  list: (b) => [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">${b.items
      .map(
        (it, i) =>
          `<tr><td valign="top" style="width:28px;padding:0 0 10px;font-family:${MONO};font-size:${b.ordered ? 13 : 16}px;line-height:1.55;color:${C.terra};">${b.ordered ? `${i + 1}.` : "&bull;"}</td><td style="padding:0 0 10px;font-family:${SERIF};font-size:16px;line-height:1.55;color:${C.ink2};">${inline(it)}</td></tr>`,
      )
      .join("")}</table>`,
    b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : "-"} ${plain(it)}`).join("\n"),
  ],
  stats: (b) => [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 22px;border-top:2px solid ${C.ink};border-bottom:1px solid ${C.line};"><tr>${b.items
      .map(
        (s) =>
          `<td valign="top" width="${Math.floor(100 / b.items.length)}%" style="padding:14px 10px 14px 0;"><div style="font-family:${SERIF};font-size:32px;line-height:1;color:${C.terra};">${esc(s.value)}</div><div style="margin-top:6px;font-family:${SANS};font-size:12px;line-height:1.4;color:${C.text2};">${inline(s.label)}</div></td>`,
      )
      .join("")}</tr></table>`,
    b.items.map((s) => `* ${s.value} — ${plain(s.label)}`).join("\n"),
  ],
  // Benchmark table: rows = fee entries from data.mjs.
  bench: (b) => {
    const head = (t, a = "left") =>
      `<th align="${a}" style="padding:8px 6px;font-family:${MONO};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${C.text2};border-bottom:2px solid ${C.ink};font-weight:normal;">${t}</th>`;
    const cell = (t, a = "right", strong = false) =>
      `<td align="${a}" style="padding:9px 6px;font-family:${a === "left" ? SANS : MONO};font-size:13px;color:${strong ? C.ink : C.ink2};border-bottom:1px solid ${C.line};${strong ? "font-weight:bold;" : ""}">${t}</td>`;
    const rows = b.rows
      .map(([, f]) => `<tr>${cell(esc(f.label), "left")}${cell(money(f.all.p25))}${cell(money(f.all.med), "right", true)}${cell(money(f.all.p75))}${cell(f.all.n.toLocaleString("en-US"))}</tr>`)
      .join("");
    const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 8px;border-collapse:collapse;"><tr>${head("Fee")}${head("Low&nbsp;25%", "right")}${head("Median", "right")}${head("High&nbsp;25%", "right")}${head("n", "right")}</tr>${rows}</table><p style="margin:0 0 20px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted};">${inline(b.note)}</p>`;
    const text = [
      "Fee | low 25% | median | high 25% | n",
      ...b.rows.map(([, f]) => `${f.label} | ${money(f.all.p25)} | ${money(f.all.med)} | ${money(f.all.p75)} | ${f.all.n.toLocaleString("en-US")}`),
      plain(b.note),
    ].join("\n");
    return [html, text];
  },
  // Horizontal bars, built from table cells so they render with images off.
  bars: (b) => {
    const max = Math.max(...b.items.map((i) => i.value));
    const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 6px;">${b.items
      .map((i) => {
        const w = Math.max(2, Math.round((i.value / max) * 100));
        const col = i.accent ? C.terra : C.ink2;
        return `<tr><td style="padding:6px 0 2px;font-family:${SANS};font-size:12px;color:${C.text2};" colspan="2">${esc(i.label)}</td></tr><tr><td style="padding:0 0 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td width="${w}%" style="background:${col};height:14px;line-height:14px;font-size:0;">&nbsp;</td><td width="${100 - w}%" style="background:${C.sand};height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr></table></td><td width="64" align="right" style="padding:0 0 6px 10px;font-family:${MONO};font-size:13px;color:${C.ink};">${esc(i.display ?? money(i.value))}</td></tr>`;
      })
      .join("")}</table>${b.note ? `<p style="margin:0 0 20px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted};">${inline(b.note)}</p>` : ""}`;
    const text = b.items.map((i) => `${i.label}: ${i.display ?? money(i.value)}`).join("\n") + (b.note ? `\n${plain(b.note)}` : "");
    return [html, text];
  },
  // Middle-half ranges on one $0..max axis, median marked; table cells, so it renders with images off.
  range: (b) => {
    const pct = (v) => Math.round((v / b.max) * 1000) / 10;
    const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 4px;">${b.items
      .map((i) => {
        const col = i.accent ? C.terra : C.ink2;
        const a = pct(i.p25), w1 = Math.max(0.5, pct(i.med) - a), w2 = Math.max(0.5, pct(i.p75) - pct(i.med)), rest = Math.max(0, 100 - a - w1 - w2);
        const seg = (w, bg, extra = "") => `<td width="${Math.round(w * 10) / 10}%" style="background:${bg};height:14px;line-height:14px;font-size:0;${extra}">&nbsp;</td>`;
        return `<tr><td style="padding:8px 0 3px;font-family:${SANS};font-size:13px;color:${i.accent ? C.ink : C.text2};${i.accent ? "font-weight:bold;" : ""}">${esc(i.label)}</td><td align="right" style="padding:8px 0 3px;font-family:${MONO};font-size:12px;color:${C.ink};white-space:nowrap;">${money(i.p25)}&ndash;${money(i.p75)} &middot; median ${money(i.med)}</td></tr><tr><td colspan="2" style="padding:0 0 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.sand};"><tr>${a > 0 ? seg(a, C.sand) : ""}${seg(w1, col, `border-right:2px solid ${C.paper};`)}${seg(w2, col)}${rest > 0 ? seg(rest, C.sand) : ""}</tr></table></td></tr>`;
      })
      .join("")}<tr><td style="padding:2px 0 0;font-family:${MONO};font-size:12px;color:${C.muted};">$0</td><td align="right" style="padding:2px 0 0;font-family:${MONO};font-size:12px;color:${C.muted};">${money(b.max)}</td></tr></table>${b.note ? `<p style="margin:6px 0 20px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted};">${inline(b.note)}</p>` : ""}`;
    const text = b.items.map((i) => `${i.label}: ${money(i.p25)} to ${money(i.p75)}, median ${money(i.med)}`).join("\n") + (b.note ? `\n${plain(b.note)}` : "");
    return [html, text];
  },
  // Boxed callouts: action (do this), rule (regulation), term (glossary), quote.
  box: (b) => {
    const tone = { action: [C.goodSoft, C.good], rule: [C.sand, C.ink], term: [C.cream, C.terra], warn: [C.terraSoft, C.terra] }[b.tone || "action"];
    const body = (b.paras || []).map((t) => `<p style="margin:0 0 10px;font-family:${SERIF};font-size:15px;line-height:1.55;color:${C.ink2};">${inline(t)}</p>`).join("");
    const items = b.items
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${b.items.map((it, i) => `<tr><td valign="top" style="width:24px;padding:0 0 8px;font-family:${MONO};font-size:12px;color:${tone[1]};">${b.ordered ? `${i + 1}.` : "&#9633;"}</td><td style="padding:0 0 8px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${C.ink2};">${inline(it)}</td></tr>`).join("")}</table>`
      : "";
    const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 22px;"><tr><td style="background:${tone[0]};border-left:4px solid ${tone[1]};padding:16px 18px 8px;"><p style="margin:0 0 10px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${tone[1]};">${esc(b.title)}</p>${body}${items}</td></tr></table>`;
    const text = [`\n[ ${b.title.toUpperCase()} ]`, ...(b.paras || []).map(plain), ...(b.items || []).map((it, i) => `${b.ordered ? `${i + 1}.` : (b.tone || "action") === "action" ? "[ ]" : "-"} ${plain(it)}`)].join("\n");
    return [html, text];
  },
  cta: (b) => [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 24px;"><tr><td style="background:${C.terra};border-radius:3px;"><a href="${b.href}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;"><span style="color:#FFFFFF;">${esc(b.text)} &rarr;</span></a></td></tr></table>${b.sub ? `<p style="margin:-14px 0 22px;font-family:${SANS};font-size:12px;color:${C.muted};">${inline(b.sub)}</p>` : ""}`,
    `${b.text}: ${b.href}${b.sub ? `\n${plain(b.sub)}` : ""}`,
  ],
  rule: () => [`<hr style="border:none;border-top:1px solid ${C.line};margin:26px 0;">`, "\n----"],
  sign: (b) => [
    `<p style="${P}margin-top:22px;">${inline(b.text || "James Gilmore")}<br><span style="display:block;font-family:${SANS};font-size:13px;line-height:1.4;color:${C.text2};">Founder, Fee Insight &middot; publisher of the Bank Fee Index</span></p>`,
    `${plain(b.text || "James Gilmore")}\nFounder, Fee Insight · publisher of the Bank Fee Index`,
  ],
};

function linkify(block, automation, emailKey) {
  const fix = (s) => (typeof s === "string" ? s.replace(/\]\((https?:[^)]+)\)/g, (_, u) => `](${utm(u, automation, emailKey)})`) : s);
  const out = { ...block };
  for (const k of ["text", "note", "sub"]) out[k] = fix(out[k]);
  if (out.href) out.href = utm(out.href, automation, emailKey);
  for (const k of ["items", "paras"]) if (Array.isArray(out[k])) out[k] = out[k].map((x) => (typeof x === "string" ? fix(x) : { ...x, label: fix(x.label) }));
  return out;
}

function renderEmail(automation, email) {
  const parts = email.blocks.map((b) => {
    const fn = R[b.type];
    if (!fn) throw new Error(`Unknown block type "${b.type}" in ${automation}/${email.key}`);
    return fn(linkify(b, automation.key, email.key));
  });
  const bodyHtml = parts.map((p) => p[0]).join("\n");
  const bodyText = parts.map((p) => p[1]).join("\n\n");
  const footerHtml = `<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};"><strong style="color:${C.ink2};">Fee Insight</strong> publishes the Bank Fee Index, built from U.S. banks' and credit unions' own published fee schedules. <a href="${utm(BRAND.siteUrl + "/methodology", automation.key, email.key)}" style="color:${C.text2};">Methodology</a></p><p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">Questions or a fee you think we got wrong? Just reply. A person reads every one.</p><p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">${BRAND.mailingAddress ? `${esc(BRAND.mailingAddress)}<br>` : ""}${esc(automation.footerReason || "You're getting this because you signed up at feeinsight.com.")}<br><a href="{$unsubscribe}" style="display:inline-block;padding:6px 0;color:${C.text2};">Unsubscribe</a></p>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(email.subject)}</title><style>table.mlMainContent{width:100%!important;min-width:0!important;max-width:680px!important;}</style></head>
<body style="margin:0;padding:0;background:${C.sand};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.sand};">${esc(email.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.sand};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${C.paper};">
<tr><td style="padding:22px 32px 16px;border-bottom:2px solid ${C.ink};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="white-space:nowrap;"><a href="https://feeinsight.com" style="text-decoration:none;"><img src="${LOGO_URL}" width="124" height="22" alt="Fee Insight" style="display:block;border:0;width:124px;height:22px;font-family:${SANS};font-size:18px;color:${C.ink};"></a></td><td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.text2};">${esc(email.masthead || automation.masthead)}</td></tr></table></td></tr>
<tr><td style="padding:30px 32px 10px;">
${bodyHtml}
</td></tr>
<tr><td style="padding:20px 32px 28px;background:${C.cream};border-top:1px solid ${C.line};">${footerHtml}</td></tr>
</table></td></tr></table></body></html>
`;
  const text = `${email.preheader}\n\n${bodyText}\n\n----\nFee Insight publishes the Bank Fee Index, built from U.S. banks' and credit unions' own published fee schedules.\nMethodology: ${BRAND.siteUrl}/methodology\nQuestions? Just reply.\n${BRAND.mailingAddress ? `${BRAND.mailingAddress}\n` : ""}Unsubscribe: {$unsubscribe}\n`;
  return { html, text, short: condense(automation, email, parts) };
}

// MailerLite's API caps plain text at 1,000 characters. The plain version is the whole
// message when it fits; otherwise every heading, paragraph, box and button goes in, in order,
// until the cap. Only an email with a chart or table points to the full version ({$url}).
const SHORT_LIMIT = 1000;
const VISUAL_BLOCKS = new Set(["stats", "bench", "bars", "range"]);
function condense(automation, email, parts) {
  const visual = email.blocks.some((b) => VISUAL_BLOCKS.has(b.type));
  const reason = automation.footerReason || "You're getting this because you signed up at feeinsight.com.";
  const tail = `\n\n${visual ? "The chart is in the full email: {$url}\n\n" : ""}--\n${BRAND.mailingAddress ? `${BRAND.mailingAddress}\n` : ""}${reason}\nUnsubscribe: {$unsubscribe}\n`;
  // UTM tags would eat the character cap; MailerLite tracks plain-text clicks on its own.
  const bare = (t) => t.replace(/https?:\/\/[^\s)]+/g, (u) => u.replace(/([?&])utm_[a-z]+=[^&#]*/g, "$1").replace(/&{2,}/g, "&").replace(/\?&+/, "?").replace(/[?&]+(?=#|$)/, ""));
  const chunks = [];
  email.blocks.forEach((b, i) => {
    parts[i] = [parts[i][0], bare(parts[i][1])];
    if (b.type === "kicker" || b.type === "rule") return;
    if (b.type === "sign") chunks.push("James Gilmore, Fee Insight");
    else if (["box", "p", "h1", "h2"].includes(b.type)) chunks.push(parts[i][1].trim());
    else chunks.push(...parts[i][1].trim().split("\n"));
  });
  let body = "";
  for (const chunk of chunks) {
    const next = body ? `${body}\n\n${chunk}` : chunk;
    if (next.length + tail.length > SHORT_LIMIT) continue;
    body = next;
  }
  return body + tail;
}

rmSync(outDir, { recursive: true, force: true });
const index = [];
for (const a of PROGRAM) {
  a.emails.forEach((e, i) => {
    const { html, text, short } = renderEmail(a, e);
    const base = `${String(i + 1).padStart(2, "0")}-${e.key}`;
    const dir = join(outDir, a.key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${base}.html`), html);
    writeFileSync(join(dir, `${base}.txt`), text);
    writeFileSync(join(dir, `${base}.short.txt`), short);
    index.push({ a, e, path: `${a.key}/${base}.html`, chars: text.length });
  });
}

const rows = (a) =>
  index
    .filter((x) => x.a === a)
    .map(
      (x) =>
        `<section><div class="meta"><b>Day ${x.e.day}</b> · <span>${esc(x.e.subject)}</span><br><i>${esc(x.e.preheader)}</i></div><iframe loading="lazy" src="${x.path}" title="${esc(x.e.subject)}"></iframe></section>`,
    )
    .join("");
writeFileSync(
  join(outDir, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fee Insight Email Program</title><style>body{margin:0;background:${C.sand};font:15px/1.5 ${SANS};color:${C.ink};padding:24px 16px}h1{font-weight:600}h2{font-weight:600;margin-top:40px;border-bottom:2px solid ${C.ink}}.meta{font-size:13px;margin:18px 0 6px}section{max-width:640px}iframe{width:100%;max-width:640px;height:900px;border:1px solid ${C.line};background:${C.paper}}</style></head><body><h1>Fee Insight email program</h1><p>${index.length} emails across ${PROGRAM.length} automations. Each file: <code>.html</code> for MailerLite custom HTML, <code>.txt</code> for the plain-text version.</p>${PROGRAM.map((a) => `<h2>${esc(a.name)}</h2><p>Trigger: ${esc(a.trigger)}</p>${rows(a)}`).join("")}</body></html>`,
);

if (!BRAND.mailingAddress) console.warn("WARN: No mailing address (MARKETING_MAILING_ADDRESS unset); CAN-SPAM requires a real postal address before sending.");
console.log(`Built ${index.length} emails into ${outDir}`);
for (const x of index) console.log(`  ${x.path}  (day ${x.e.day}, ${x.chars} chars plain text)  ${x.e.subject}`);
