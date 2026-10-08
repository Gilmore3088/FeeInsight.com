import { SITE_URL } from "@/lib/constants";

/**
 * The small Markdown subset research articles use, rendered to HTML-safe markup: headings,
 * bold, italic, http(s) links, "- " lists and "|" tables. Raw HTML is escaped first. Blocks
 * are separated by blank lines, so a list becomes one <ul> and a table one <table>. Links to
 * this site open in the same tab; other sites open in a new one.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Quotes too: links become href="…" attributes, and a raw " would end the attribute.
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isOwnSite(href: string, base: string): boolean {
  try {
    return new URL(href).host === new URL(base).host;
  } catch {
    return false;
  }
}

function inline(text: string, base: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, href: string) =>
      isOwnSite(href.replace(/&amp;/g, "&"), base)
        ? `<a href="${href}">${label}</a>`
        : `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`,
    );
}

function tableHtml(lines: string[], base: string): string {
  const rows = lines
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
  const [head, ...body] = rows;
  const cells = (row: string[], tag: "th" | "td") => row.map((cell) => `<${tag}>${inline(cell, base)}</${tag}>`).join("");
  return `<table><thead><tr>${cells(head ?? [], "th")}</tr></thead><tbody>${body.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody></table>`;
}

/**
 * A bar chart block: "```bars Title", then one "Label | value | shown value" line per bar,
 * then "```". Bars are scaled to the largest value; the shown value prints beside each bar.
 */
function barsHtml(lines: string[], base: string): string {
  const title = lines[0].replace(/^```bars\s*/, "");
  const rows = lines
    .slice(1, -1)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length === 3 && Number.isFinite(Number(cells[1])));
  const max = Math.max(...rows.map((cells) => Number(cells[1])), 0);
  const bar = ([label, value, shown]: string[]) => {
    const width = max > 0 ? Math.max(2, Math.round((Number(value) / max) * 100)) : 0;
    return (
      `<div style="display:grid;grid-template-columns:minmax(7rem,38%) 1fr auto;gap:0.6rem;align-items:center;margin:0.35rem 0">` +
      `<span style="font-size:13px;line-height:1.25">${inline(label, base)}</span>` +
      `<span style="display:block;height:14px;border-radius:3px;background:#EFE8DC"><span style="display:block;height:14px;border-radius:3px;width:${width}%;background:#C44B2E"></span></span>` +
      `<span style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums">${inline(shown, base)}</span></div>`
    );
  };
  return `<figure style="margin:1.25rem 0">${title ? `<figcaption style="font-size:13px;font-weight:600;margin-bottom:0.5rem">${inline(title, base)}</figcaption>` : ""}${rows.map(bar).join("")}</figure>`;
}

export function renderArticleMarkdown(content: string, base: string = SITE_URL): string {
  const blocks = escapeHtml(content.replace(/\r\n/g, "\n")).split(/\n{2,}/);
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const heading = /^(#{1,3}) (.+)$/.exec(block);
      if (heading && lines.length === 1) {
        const level = heading[1].length;
        return `<h${level}>${inline(heading[2], base)}</h${level}>`;
      }
      if (lines[0].startsWith("```bars") && lines[lines.length - 1] === "```") return barsHtml(lines, base);
      if (lines.every((line) => line.startsWith("- "))) {
        return `<ul>${lines.map((line) => `<li>${inline(line.slice(2), base)}</li>`).join("")}</ul>`;
      }
      if (lines.every((line) => line.startsWith("|"))) return tableHtml(lines, base);
      return `<p>${lines.map((line) => inline(line, base)).join("<br/>")}</p>`;
    })
    .join("");
}
