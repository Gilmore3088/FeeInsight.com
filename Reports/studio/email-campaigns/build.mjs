// Renders the Fee Insight email program (content.mjs) into MailerLite-ready files:
//   out/<automation>/<nn>-<slug>.html  — paste into MailerLite "Custom HTML"
//   out/<automation>/<nn>-<slug>.txt   — paste into the plain-text version
//   out/index.html                     — one-page preview of every email
// Usage: node Reports/studio/email-campaigns/build.mjs
// Email-safe HTML only: tables, inline styles, no web fonts or images required.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROGRAM, BRAND } from "./content.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");

const C = {
  ink: "#1A1815", ink2: "#3D3830", text2: "#6E655A", muted: "#9A9082",
  paper: "#FFFFFF", cream: "#FDFBF8", sand: "#F4EEE4",
  terra: "#C44B2E", terraSoft: "#FBEDE8", good: "#1F7A4A", goodSoft: "#E8F2EB",
  line: "#E3DACB",
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";

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
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=mailerlite&utm_medium=email&utm_campaign=${automation}&utm_content=${email}`;
}

// ---------- block renderers (html, text) ----------
const P = `margin:0 0 16px;font-family:${SERIF};font-size:17px;line-height:1.6;color:${C.ink2};`;

const R = {
  kicker: (b) => [
    `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.terra};">${esc(b.text)}</p>`,
    b.text.toUpperCase(),
  ],
  h1: (b) => [
    `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:30px;line-height:1.18;font-weight:normal;color:${C.ink};">${inline(b.text)}</h1>`,
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
          `<tr><td valign="top" style="width:28px;padding:0 0 10px;font-family:${MONO};font-size:13px;color:${C.terra};">${b.ordered ? `${i + 1}.` : "&mdash;"}</td><td style="padding:0 0 10px;font-family:${SERIF};font-size:16px;line-height:1.55;color:${C.ink2};">${inline(it)}</td></tr>`,
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
      .map(([, f]) => `<tr>${cell(esc(f.label), "left")}${cell(money(f.all.p25))}${cell(money(f.all.med), "right", true)}${cell(money(f.all.p75))}${cell(money(f.bank.med))}${cell(money(f.cu.med))}${cell(String(f.all.n))}</tr>`)
      .join("");
    const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 8px;border-collapse:collapse;"><tr>${head("Fee")}${head("Low&nbsp;25%", "right")}${head("Median", "right")}${head("High&nbsp;25%", "right")}${head("Banks", "right")}${head("CUs", "right")}${head("n", "right")}</tr>${rows}</table><p style="margin:0 0 20px;font-family:${SANS};font-size:11px;line-height:1.5;color:${C.muted};">${inline(b.note)}</p>`;
    const text = [
      "Fee | low 25% | median | high 25% | banks | CUs | n",
      ...b.rows.map(([, f]) => `${f.label} | ${money(f.all.p25)} | ${money(f.all.med)} | ${money(f.all.p75)} | ${money(f.bank.med)} | ${money(f.cu.med)} | ${f.all.n}`),
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
      .join("")}</table>${b.note ? `<p style="margin:0 0 20px;font-family:${SANS};font-size:11px;line-height:1.5;color:${C.muted};">${inline(b.note)}</p>` : ""}`;
    const text = b.items.map((i) => `${i.label}: ${i.display ?? money(i.value)}`).join("\n") + (b.note ? `\n${plain(b.note)}` : "");
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
    const text = [`\n[ ${b.title.toUpperCase()} ]`, ...(b.paras || []).map(plain), ...(b.items || []).map((it, i) => `${b.ordered ? `${i + 1}.` : "[ ]"} ${plain(it)}`)].join("\n");
    return [html, text];
  },
  cta: (b) => [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 24px;"><tr><td style="background:${C.terra};border-radius:3px;"><a href="${b.href}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${esc(b.text)} &rarr;</a></td></tr></table>${b.sub ? `<p style="margin:-14px 0 22px;font-family:${SANS};font-size:12px;color:${C.muted};">${inline(b.sub)}</p>` : ""}`,
    `${b.text}: ${b.href}${b.sub ? `\n${plain(b.sub)}` : ""}`,
  ],
  rule: () => [`<hr style="border:none;border-top:1px solid ${C.line};margin:26px 0;">`, "\n----"],
  sign: (b) => [
    `<p style="${P}margin-top:22px;">${inline(b.text || "James Gilmore")}<br><span style="font-family:${SANS};font-size:13px;color:${C.text2};">Founder, Fee Insight &middot; publisher of the Bank Fee Index</span></p>`,
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
  const footerHtml = `<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};"><strong style="color:${C.ink2};">Fee Insight</strong> publishes the Bank Fee Index: fee schedules from ${BRAND.institutionsLabel} U.S. banks and credit unions, each figure linked to the published document it came from. <a href="${utm(BRAND.siteUrl + "/methodology", automation.key, email.key)}" style="color:${C.text2};">Methodology</a></p><p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">Questions or a fee you think we got wrong? Just reply. A person reads every one.</p><p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">${esc(BRAND.mailingAddress)}<br>You're getting this because you signed up at feeinsight.com. <a href="{$unsubscribe}" style="color:${C.text2};">Unsubscribe</a></p>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(email.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.sand};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.sand};">${esc(email.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.sand};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${C.paper};">
<tr><td style="padding:22px 32px 16px;border-bottom:2px solid ${C.ink};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="font-family:${SERIF};font-size:20px;color:${C.ink};white-space:nowrap;">Fee Insight</td><td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.text2};">${esc(email.masthead || automation.masthead)}</td></tr></table></td></tr>
<tr><td style="padding:30px 32px 10px;">
${bodyHtml}
</td></tr>
<tr><td style="padding:20px 32px 28px;background:${C.cream};border-top:1px solid ${C.line};">${footerHtml}</td></tr>
</table></td></tr></table></body></html>
`;
  const text = `${email.preheader}\n\n${bodyText}\n\n----\nFee Insight publishes the Bank Fee Index: fee schedules from ${BRAND.institutionsLabel} U.S. banks and credit unions.\nMethodology: ${BRAND.siteUrl}/methodology\nQuestions? Just reply.\n${BRAND.mailingAddress}\nUnsubscribe: {$unsubscribe}\n`;
  return { html, text };
}

rmSync(outDir, { recursive: true, force: true });
const index = [];
for (const a of PROGRAM) {
  a.emails.forEach((e, i) => {
    const { html, text } = renderEmail(a, e);
    const base = `${String(i + 1).padStart(2, "0")}-${e.key}`;
    const dir = join(outDir, a.key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${base}.html`), html);
    writeFileSync(join(dir, `${base}.txt`), text);
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
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fee Insight Email Program</title><style>body{margin:0;background:#F4EEE4;font:15px/1.5 Helvetica,Arial,sans-serif;color:#1A1815;padding:24px 16px}h1{font-family:Georgia,serif;font-weight:normal}h2{font-family:Georgia,serif;font-weight:normal;margin-top:40px;border-bottom:2px solid #1A1815}.meta{font-size:13px;margin:18px 0 6px}section{max-width:640px}iframe{width:100%;max-width:640px;height:900px;border:1px solid #E3DACB;background:#fff}</style></head><body><h1>Fee Insight email program</h1><p>${index.length} emails across ${PROGRAM.length} automations. Each file: <code>.html</code> for MailerLite custom HTML, <code>.txt</code> for the plain-text version.</p>${PROGRAM.map((a) => `<h2>${esc(a.name)}</h2><p>Trigger: ${esc(a.trigger)}</p>${rows(a)}`).join("")}</body></html>`,
);

if (BRAND.mailingAddress.includes("[")) console.warn("WARN: BRAND.mailingAddress is a placeholder; CAN-SPAM requires a real postal address before sending.");
console.log(`Built ${index.length} emails into ${outDir}`);
for (const x of index) console.log(`  ${x.path}  (day ${x.e.day}, ${x.chars} chars plain text)  ${x.e.subject}`);
