/**
 * A stored research article, read into the research-brief shape the template renders: an
 * opening finding, then sections of title -> one finding -> labeled exhibit -> source, with the
 * method section held apart for a disclosure. The article body is never rewritten; this only
 * decides where each of its blocks sits. Blocks are the Markdown subset of
 * `src/lib/article-markdown.ts`: paragraphs, "## " headings, "- " lists, "|" tables and
 * "```bars" charts, separated by blank lines.
 */

export interface BarsRow {
  label: string;
  value: number;
  shown: string;
}

export interface TableData {
  head: string[];
  rows: string[][];
}

export type Exhibit =
  | { kind: "bars"; label: string; rows: BarsRow[]; table: TableData | null }
  | { kind: "table"; label: string; table: TableData };

export interface ArticleSection {
  id: string;
  title: string;
  /** The section's first paragraph, shown straight under its title. */
  finding: string | null;
  /** Any further paragraphs and lists, as Markdown blocks in their written order. */
  notes: string[];
  exhibits: Exhibit[];
  /** The article's own "Source:" line for the section, when it wrote one. */
  source: string | null;
}

export interface ArticleBrief {
  /** Paragraphs before the first heading: the article's opening finding. */
  lead: string[];
  /** A chart or table before the first heading. */
  leadExhibits: Exhibit[];
  sections: ArticleSection[];
  method: { title: string; blocks: string[] } | null;
  /** "October 2026" from a closing "As of October 2026." line, which the byline then carries. */
  asOf: string | null;
}

const METHOD_TITLE = /^(how (these|the|we|this)\b|method|methodology|about (the|this) data|data and method)/i;
const SOURCE_LINE = /^sources?:\s*/i;
const AS_OF_LINE = /^as of ([^.]+)\.?$/i;

function blocksOf(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isBars(lines: string[]): boolean {
  return lines[0].startsWith("```bars") && lines[lines.length - 1] === "```";
}

function isTable(lines: string[]): boolean {
  return lines.every((line) => line.startsWith("|"));
}

export function parseBars(block: string): { label: string; rows: BarsRow[] } {
  const lines = block.split("\n");
  const rows = lines
    .slice(1, -1)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length === 3 && cells[1] !== "" && Number.isFinite(Number(cells[1])))
    .map(([label, value, shown]) => ({ label, value: Number(value), shown }));
  return { label: lines[0].replace(/^```bars\s*/, "").trim(), rows };
}

export function parseTable(block: string): TableData {
  const rows = block
    .split("\n")
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
  const [head = [], ...body] = rows;
  return { head, rows: body };
}

/**
 * A standalone table's label, from its own columns: "Institutions, lowest, median and highest,
 * by state". Plain text, so the Markdown marks are dropped.
 */
export function tableLabel(table: TableData): string {
  const plain = (cell: string) => cell.replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  const [first, ...rest] = table.head.map(plain).filter(Boolean);
  if (!first) return "Table";
  if (rest.length === 0) return first;
  const names = rest.map((name, i) => (i === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1)));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list}, by ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
}

/** A stable anchor for a section title. */
export function sectionId(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

interface Bucket {
  prose: string[];
  exhibits: Exhibit[];
  source: string | null;
}

function fill(bucket: Bucket, block: string): void {
  const lines = block.split("\n");
  if (isBars(lines)) {
    const { label, rows } = parseBars(block);
    if (rows.length > 0) bucket.exhibits.push({ kind: "bars", label, rows, table: null });
    return;
  }
  if (isTable(lines)) {
    const table = parseTable(block);
    // A table straight after a chart holds the chart's figures: one exhibit, under the chart's label.
    const last = bucket.exhibits[bucket.exhibits.length - 1];
    if (last && last.kind === "bars" && last.table === null) last.table = table;
    else bucket.exhibits.push({ kind: "table", label: tableLabel(table), table });
    return;
  }
  if (SOURCE_LINE.test(block) && lines.length === 1) {
    bucket.source = block.replace(SOURCE_LINE, "");
    return;
  }
  bucket.prose.push(block);
}

export function parseArticle(content: string): ArticleBrief {
  const blocks = blocksOf(content);
  let asOf: string | null = null;
  // A closing "As of October 2026." belongs to the byline, not the last section.
  const lastBlock = blocks[blocks.length - 1];
  const asOfMatch = lastBlock ? AS_OF_LINE.exec(lastBlock) : null;
  if (asOfMatch && !lastBlock.includes("\n")) {
    asOf = asOfMatch[1].trim();
    blocks.pop();
  }

  const lead: Bucket = { prose: [], exhibits: [], source: null };
  const sections: (Bucket & { title: string })[] = [];
  let method: { title: string; blocks: string[] } | null = null;
  let current: Bucket | null = lead;
  let inMethod = false;

  for (const block of blocks) {
    const heading = /^#{1,3} (.+)$/.exec(block);
    if (heading && !block.includes("\n")) {
      const title = heading[1].trim();
      if (!method && METHOD_TITLE.test(title)) {
        method = { title, blocks: [] };
        inMethod = true;
        current = null;
      } else {
        inMethod = false;
        const section = { title, prose: [], exhibits: [], source: null };
        sections.push(section);
        current = section;
      }
      continue;
    }
    if (inMethod && method) method.blocks.push(block);
    else if (current) fill(current, block);
  }

  const taken = new Set<string>();
  return {
    lead: lead.prose,
    leadExhibits: lead.exhibits,
    sections: sections.map((s) => {
      // The finding is the first paragraph, wherever it was written; a list never stands as one.
      const findingIndex = s.prose.findIndex((block) => !block.split("\n").every((line) => line.startsWith("- ")));
      return {
        id: sectionId(s.title, taken),
        title: s.title,
        finding: findingIndex === -1 ? null : s.prose[findingIndex],
        notes: s.prose.filter((_, i) => i !== findingIndex),
        exhibits: s.exhibits,
        source: s.source,
      };
    }),
    method,
    asOf,
  };
}

/** Rows shown before "Show all": a table of up to this many plus two shows whole. */
export const TABLE_ROWS_SHOWN = 5;

export function tableFolds(rows: number): boolean {
  return rows > TABLE_ROWS_SHOWN + 2;
}

/** Plain text for a description: the opening finding without Markdown marks, cut at a word. */
export function plainSummary(brief: ArticleBrief, max = 160): string {
  const source = brief.lead.length > 0 ? brief.lead.join(" ") : (brief.sections.find((s) => s.finding)?.finding ?? "");
  const text = source
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim()}...`;
}

/** "October 8, 2026" for a byline, read in UTC so the date never shifts by a server's zone. */
export function bylineDate(value: string | Date | null | undefined): { label: string; iso: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    label: date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
    iso: date.toISOString(),
  };
}
